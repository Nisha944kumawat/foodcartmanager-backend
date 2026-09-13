import { Router } from 'express';
import mongoose from 'mongoose';
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
  const shareProfit = Number(x._calculatedShareProfit ?? 0);
  const platesSell = Math.max(0, quantity - returned);
  const netSold = Math.max(0, platesSell - returned);
  const sales = netSold * price;
  const returnLoss = returned * unitCost;
  const makingCost = platesSell * unitCost;
  const shareProfitTotal = netSold * shareProfit;
  const profit = sales - makingCost - shareProfitTotal;
  const perPlateProfitLoss = price - unitCost - shareProfit;
  return { quantity, returned, platesSell, netSold, sales, returnLoss, makingCost, shareProfitTotal, profit, perPlateProfitLoss };
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
    // A sale may reference a deleted dish. After populate, dishId becomes null.
    // Do not convert null to "null" and send it to MongoDB as an ObjectId.
    const dishIds = [...new Set(sales
      .map(s => s.dishId?._id ? String(s.dishId._id) : (s.dishId ? String(s.dishId) : null))
      .filter(id => id && mongoose.Types.ObjectId.isValid(id)))];
    const dishDocs = await Dish.find({ userId: req.user.id, _id: { $in: dishIds } });
    const costMap = new Map();
    const shareMap = new Map();
    await Promise.all(dishDocs.map(async d => {
      const c = await costing(d, req.user.id);
      costMap.set(String(d._id), c.dishCost);
      shareMap.set(String(d._id), c.shareProfit);
    }));
    sales.forEach(x => {
      const id = String(x.dishId?._id || x.dishId);
      if (costMap.has(id)) x._calculatedUnitCost = costMap.get(id);
      if (shareMap.has(id)) x._calculatedShareProfit = shareMap.get(id);
    });

    let revenue = 0;
    let returnLoss = 0;
    let makingCost = 0;
    let platesSell = 0;
    let returned = 0;
    let netSold = 0;
    let profit = 0;
    const byDish = {};

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
        .sort((a,b)=>b.profit-a.profit)
    });
  } catch(e) {
    res.status(500).json({message:e.message});
  }
});
export default r;
