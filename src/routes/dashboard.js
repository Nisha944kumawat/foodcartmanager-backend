import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import Sale from '../models/Sale.js';
import Ingredient from '../models/Ingredient.js';
import Dish from '../models/Dish.js';
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

function buildDaily(start, end, sales) {
  const map = new Map();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    map.set(dayKey(d), { date: dayKey(d), sales: 0, returnLoss: 0, makingCost: 0, platesMade: 0, returned: 0, netSold: 0, profit: 0 });
  }

  sales.forEach(s => {
    const key = dayKey(s.date);
    if (!map.has(key)) return;
    const row = map.get(key);
    const quantity = Number(s.quantity || 0);
    const returned = Number(s.returnedQuantity || 0);
    const price = Number(s.sellingPrice || 0);
    const unitCost = Number(s.unitCost || 0);
    const grossSales = quantity * price;
    const returnCost = returned * unitCost;
    const netSales = grossSales - (returned * price);
    const makingCost = quantity * unitCost;

    row.platesMade += quantity;
    row.returned += returned;
    row.netSold += Math.max(0, quantity - returned);
    row.sales += netSales;
    row.returnLoss += returnCost;
    row.makingCost += makingCost;
    row.profit += netSales - makingCost;
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

    const revenue = sales.reduce((sum, x) => {
      const quantity = Number(x.quantity || 0);
      const returned = Number(x.returnedQuantity || 0);
      const price = Number(x.sellingPrice || 0);
      return sum + (quantity - returned) * price;
    }, 0);
    const returnLoss = sales.reduce((sum, x) => sum + Number(x.returnedQuantity || 0) * Number(x.unitCost || 0), 0);
    const makingCost = sales.reduce((sum, x) => sum + Number(x.quantity || 0) * Number(x.unitCost || 0), 0);
    const platesMade = sales.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
    const returned = sales.reduce((sum, x) => sum + Number(x.returnedQuantity || 0), 0);
    const netSold = sales.reduce((sum, x) => sum + Math.max(0, Number(x.quantity || 0) - Number(x.returnedQuantity || 0)), 0);
    const profit = revenue - makingCost;

    const byDishMap = {};
    for (const x of sales) {
      const name = x.dishId?.name || 'Deleted dish';
      byDishMap[name] ??= { sales: 0, cost: 0, profit: 0, quantity: 0, returned: 0 };
      const quantity = Number(x.quantity || 0);
      const returnedQty = Number(x.returnedQuantity || 0);
      const price = Number(x.sellingPrice || 0);
      const unitCost = Number(x.unitCost || 0);
      const netSales = (quantity - returnedQty) * price;
      const dishMakingCost = quantity * unitCost;
      const dishReturnCost = returnedQty * unitCost;
      byDishMap[name].sales += netSales;
      byDishMap[name].cost += dishMakingCost;
      byDishMap[name].profit += netSales - dishMakingCost;
      byDishMap[name].quantity += quantity;
      byDishMap[name].returned += returnedQty;
    }

    res.json({
      range: { from: a, to: b },
      type,
      today: { sales: revenue, returnLoss, makingCost, profit, platesMade, returned, netSold },
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
