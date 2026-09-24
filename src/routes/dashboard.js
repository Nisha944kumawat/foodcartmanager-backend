import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import Sale from '../models/Sale.js';
import Ingredient from '../models/Ingredient.js';
import Dish from '../models/Dish.js';
import { costing } from './dishes.js';
import { dateRange } from '../utils.js';

const r = Router();
r.use(auth);

function dayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sale.quantity stores the total entered plates (plates sold + returned).
// Therefore the original Plates Sell value is quantity - returnedQuantity.
// Returns are shown as return loss, but their cost is NOT subtracted again from profit.
function saleNumbers(s) {
  const quantity = Number(s.quantity || 0);
  const returned = Number(s.returnedQuantity || 0);
  const price = Number(s.sellingPrice || 0);
  const unitCost = Number(s._calculatedUnitCost ?? s.unitCost ?? 0);
  const platesSell = Math.max(0, quantity - returned);
  const netSold = Math.max(0, platesSell - returned);
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const sales = round2(netSold * price);
  const returnLoss = round2(returned * unitCost);
  const makingCost = round2(platesSell * unitCost);
  const profit = round2(sales - makingCost);
  const perPlateProfitLoss = Math.round((price - unitCost + Number.EPSILON) * 100) / 100;

  return { quantity, returned, price, unitCost, platesSell, netSold, sales, returnLoss, makingCost, profit, perPlateProfitLoss };
}

function buildDaily(start, end, sales) {
  const map = new Map();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    map.set(dayKey(d), { date: dayKey(d), sales: 0, returnLoss: 0, makingCost: 0, platesMade: 0, returned: 0, netSold: 0, profit: 0 });
  }

  sales.forEach(s => {
    const key = dayKey(s.date);
    if (!map.has(key)) return;
    const row = map.get(key);
    const v = saleNumbers(s);

    row.platesMade += v.platesSell;
    row.returned += v.returned;
    row.netSold += v.netSold;
    row.sales += v.sales;
    row.returnLoss += v.returnLoss;
    row.makingCost += v.makingCost;
    row.profit += v.profit;
  });

  return [...map.values()];
}

r.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'today';
    const { a, b } = dateRange(type, req.query.from, req.query.to);
    const m = { userId: req.user.id, date: { $gte: a, $lte: b } };

    const [sales, dishes, ingredients] = await Promise.all([
      Sale.find(m).populate('dishId', 'name'),
      Dish.countDocuments({ userId: req.user.id, active: true }),
      Ingredient.countDocuments({ userId: req.user.id, active: true })
    ]);

    // Sales created before the calculation fix may contain the old cost-per-piece
    // snapshot (e.g. ₹3.43). For reporting, a dish means one plate/serving, so
    // the correct cost is Dish Cost = costPerPiece × piecesPerDish (e.g. ₹10.29).
    // Recalculate the dish cost from the current recipe so old saved sales also
    // follow the same rule as newly saved sales.
    const dishIds = [...new Set(sales.map(s => String(s.dishId?._id || s.dishId)).filter(Boolean))];
    const dishDocs = await Dish.find({ userId: req.user.id, _id: { $in: dishIds } });
    const costMap = new Map();
    await Promise.all(dishDocs.map(async d => {
      const c = await costing(d, req.user.id);
      costMap.set(String(d._id), c.dishCost);
    }));
    sales.forEach(s => {
      const id = String(s.dishId?._id || s.dishId);
      if (costMap.has(id)) s._calculatedUnitCost = costMap.get(id);
    });

    let revenue = 0;
    let returnLoss = 0;
    let makingCost = 0;
    let platesSell = 0;
    let returned = 0;
    let netSold = 0;
    let profit = 0;

    const byDishMap = {};
    for (const x of sales) {
      const v = saleNumbers(x);
      revenue += v.sales;
      returnLoss += v.returnLoss;
      makingCost += v.makingCost;
      platesSell += v.platesSell;
      returned += v.returned;
      netSold += v.netSold;
      profit += v.profit;

      const name = x.dishId?.name || 'Deleted dish';
      byDishMap[name] ??= { sales: 0, cost: 0, profit: 0, quantity: 0, returned: 0, netSold: 0, platesSell: 0, perPlateProfitLoss: 0 };
      byDishMap[name].sales += v.sales;
      byDishMap[name].cost += v.makingCost;
      byDishMap[name].profit += v.profit;
      byDishMap[name].quantity += v.quantity;
      byDishMap[name].returned += v.returned;
      byDishMap[name].platesSell += v.platesSell;
      byDishMap[name].netSold += v.netSold;
      // This is the same per-dish/per-plate profit shown in Dishes & Recipes:
      // selling price - cost of the pieces used in one dish.
      byDishMap[name].perPlateProfitLoss = v.perPlateProfitLoss;
    }

    res.json({
      range: { from: a, to: b },
      type,
      today: { sales: revenue, returnLoss, makingCost, profit, platesMade: platesSell, returned, netSold },
      totals: { dishes, ingredients },
      daily: buildDaily(a, b, sales),
      byDish: Object.entries(byDishMap)
        .map(([dish, v]) => ({ dish, ...v }))
        .sort((a, b) => b.profit - a.profit)
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default r;
