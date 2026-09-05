import { Router } from 'express';
import Sale from '../models/Sale.js';
import { auth } from '../middleware/auth.js';
import { dateRange } from '../utils.js';

const r = Router();
r.use(auth);

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dailyRows(a, b, sales) {
  const map = new Map();
  for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)) {
    map.set(dayKey(d), { date: dayKey(d), sales: 0, returnLoss: 0, makingCost: 0, platesMade: 0, returned: 0, netSold: 0, profit: 0 });
  }
  sales.forEach(x => {
    const row = map.get(dayKey(x.date));
    if (!row) return;
    const quantity = Number(x.quantity || 0);
    const returned = Number(x.returnedQuantity || 0);
    const price = Number(x.sellingPrice || 0);
    const unitCost = Number(x.unitCost || 0);
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

r.get('/', async (req,res) => {
  try {
    const { a,b } = dateRange(req.query.type || 'today', req.query.from, req.query.to);
    const m = { userId:req.user.id, date:{$gte:a,$lte:b} };
    const sales = await Sale.find(m).populate('dishId','name');
    const revenue=sales.reduce((sum,x)=>sum+(Number(x.quantity||0)-Number(x.returnedQuantity||0))*Number(x.sellingPrice||0),0);
    const returnLoss=sales.reduce((sum,x)=>sum+Number(x.returnedQuantity||0)*Number(x.unitCost||0),0);
    const makingCost=sales.reduce((sum,x)=>sum+Number(x.quantity||0)*Number(x.unitCost||0),0);
    const returnCost=sales.reduce((sum,x)=>sum+Number(x.returnedQuantity||0)*Number(x.unitCost||0),0);
    const platesMade=sales.reduce((sum,x)=>sum+Number(x.quantity||0),0);
    const returned=sales.reduce((sum,x)=>sum+Number(x.returnedQuantity||0),0);
    const netSold=sales.reduce((sum,x)=>sum+Math.max(0,Number(x.quantity||0)-Number(x.returnedQuantity||0)),0);
    const byDish={};
    for(const x of sales){
      const n=x.dishId?.name||'Deleted dish';
      byDish[n]??={sales:0,cost:0,profit:0,quantity:0,returned:0};
      const quantity=Number(x.quantity||0);
      const returnedQty=Number(x.returnedQuantity||0);
      const price=Number(x.sellingPrice||0);
      const unitCost=Number(x.unitCost||0);
      const netSales=(quantity-returnedQty)*price;
      const dishMakingCost=quantity*unitCost;
      const dishReturnCost=returnedQty*unitCost;
      byDish[n].sales+=netSales;
      byDish[n].cost+=dishMakingCost;
      byDish[n].profit+=netSales-dishMakingCost;
      byDish[n].quantity+=quantity;
      byDish[n].returned+=returnedQty;
    }
    res.json({
      range:{from:a,to:b},
      summary:{
        revenue,returnLoss,makingCost,platesMade,returned,netSold,
        profit:revenue-makingCost
      },
      daily:dailyRows(a,b,sales),
      sales,
      byDish:Object.entries(byDish).map(([dish,v])=>({dish,...v})).sort((a,b)=>b.profit-a.profit)
    });
  } catch(e) {
    res.status(500).json({message:e.message});
  }
});
export default r;
