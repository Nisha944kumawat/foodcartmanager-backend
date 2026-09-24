import { Router } from 'express';
import Sale from '../models/Sale.js';
import Dish from '../models/Dish.js';
import { auth } from '../middleware/auth.js';
import { dateRange } from '../utils.js';
import { costing } from './dishes.js';

const r = Router();
r.use(auth);

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Sale.quantity stores total entered plates (plates sold + returned).
// Plates Sell = quantity - returnedQuantity.
// Return loss is informational only; it is NOT subtracted a second time from profit.
function saleNumbers(x) {
  const quantity = Number(x.quantity || 0);
  const returned = Number(x.returnedQuantity || 0);
  const price = Number(x.sellingPrice || 0);
  const unitCost = Number(x._calculatedUnitCost ?? x.unitCost ?? 0);
  const platesSell = Math.max(0, quantity - returned);
  const netSold = Math.max(0, platesSell - returned);
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const sales = round2(netSold * price);
  const returnLoss = round2(returned * unitCost);
  const makingCost = round2(platesSell * unitCost);
  const profit = round2(sales - makingCost);
  const perPlateProfitLoss = Math.round((price - unitCost + Number.EPSILON) * 100) / 100;
  return { quantity, returned, platesSell, netSold, sales, returnLoss, makingCost, profit, perPlateProfitLoss };
}

function dailyRows(a, b, sales) {
  const map = new Map();
  for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)) {
    map.set(dayKey(d), { date: dayKey(d), sales: 0, returnLoss: 0, makingCost: 0, platesMade: 0, returned: 0, netSold: 0, profit: 0 });
  }
  sales.forEach(x => {
    const row = map.get(dayKey(x.date));
    if (!row) return;
    const v = saleNumbers(x);
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

r.get('/', async (req,res) => {
  try {
    const { a,b } = dateRange(req.query.type || 'today', req.query.from, req.query.to);
    const m = { userId:req.user.id, date:{$gte:a,$lte:b} };
    const sales = await Sale.find(m).populate('dishId','name');

    // Use the dish cost for one complete dish/plate, not the raw cost of one
    // produced piece. This also corrects older saved sales that stored the
    // pre-fix unitCost (costPerPiece).
    const dishIds = [...new Set(sales.map(s => String(s.dishId?._id || s.dishId)).filter(Boolean))];
    const dishDocs = await Dish.find({ userId: req.user.id, _id: { $in: dishIds } });
    const costMap = new Map();
    await Promise.all(dishDocs.map(async d => {
      const c = await costing(d, req.user.id);
      costMap.set(String(d._id), c.dishCost);
    }));
    sales.forEach(x => {
      const id = String(x.dishId?._id || x.dishId);
      if (costMap.has(id)) x._calculatedUnitCost = costMap.get(id);
    });

    let revenue = 0;
    let returnLoss = 0;
    let makingCost = 0;
    let platesSell = 0;
    let returned = 0;
    let netSold = 0;
    let profit = 0;
    const byDish = {};
    const byDayDish = {};

    for(const x of sales){
      const v = saleNumbers(x);
      revenue += v.sales;
      returnLoss += v.returnLoss;
      makingCost += v.makingCost;
      platesSell += v.platesSell;
      returned += v.returned;
      netSold += v.netSold;
      profit += v.profit;

      const n=x.dishId?.name||'Deleted dish';
      byDish[n]??={sales:0,cost:0,profit:0,quantity:0,returned:0,netSold:0,platesSell:0,perPlateProfitLoss:0};
      byDish[n].sales += v.sales;
      byDish[n].cost += v.makingCost;
      byDish[n].profit += v.profit;
      byDish[n].quantity += v.quantity;
      byDish[n].returned += v.returned;
      byDish[n].netSold += v.netSold;
      byDish[n].platesSell += v.platesSell;
      // Per plate profit is the same calculation shown while adding the dish.
      byDish[n].perPlateProfitLoss = v.perPlateProfitLoss;

      // Keep report table rows separated by calendar date + dish.
      const date = dayKey(x.date);
      const key = `${date}\u0000${n}`;
      byDayDish[key] ??= { date, dish: n, sales: 0, cost: 0, profit: 0, quantity: 0, returned: 0, netSold: 0, platesSell: 0, perPlateProfitLoss: 0 };
      byDayDish[key].sales += v.sales;
      byDayDish[key].cost += v.makingCost;
      byDayDish[key].profit += v.profit;
      byDayDish[key].quantity += v.quantity;
      byDayDish[key].returned += v.returned;
      byDayDish[key].netSold += v.netSold;
      byDayDish[key].platesSell += v.platesSell;
      byDayDish[key].perPlateProfitLoss = v.perPlateProfitLoss;
    }

    res.json({
      range:{from:a,to:b},
      summary:{
        revenue,returnLoss,makingCost,platesMade:platesSell,returned,netSold,
        profit
      },
      daily:dailyRows(a,b,sales),
      sales,
      byDish:Object.entries(byDish)
        .map(([dish,v])=>({dish,...v}))
        .sort((a,b)=>b.profit-a.profit),
      byDayDish:Object.values(byDayDish)
        .sort((a,b)=>a.date.localeCompare(b.date) || a.dish.localeCompare(b.dish))
    });
  } catch(e) {
    res.status(500).json({message:e.message});
  }
});
export default r;
