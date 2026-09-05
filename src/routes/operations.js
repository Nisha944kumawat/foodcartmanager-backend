import { Router } from 'express';
import Production from '../models/Production.js';
import Sale from '../models/Sale.js';
import Expense from '../models/Expense.js';
import Dish from '../models/Dish.js';
import { auth } from '../middleware/auth.js';
import { costing } from './dishes.js';
import { parseDateInput } from '../utils.js';

const r = Router();
r.use(auth);

r.post('/production', async (req, res) => {
  try {
    const d = await Dish.findOne({ _id: req.body.dishId, userId: req.user.id, active: true });
    if (!d) return res.status(404).json({ message: 'Dish not found' });
    const c = await costing(d, req.user.id);
    const batches = Number(req.body.batches);
    const qty = Number(req.body.quantityProduced);
    if (!(batches > 0 && qty > 0)) return res.status(400).json({ message: 'Batches and produced quantity must be greater than zero' });

    const p = await Production.create({
      userId: req.user.id,
      dishId: d._id,
      date: req.body.date ? parseDateInput(req.body.date) : new Date(),
      batches,
      quantityProduced: qty,
      yieldUnit: d.yieldUnit,
      totalCost: c.totalCost * batches,
      unitCost: (c.totalCost * batches) / qty,
      ingredientUsage: c.lines.map(x => ({
        ingredientId: x.ingredientId,
        name: x.name,
        quantity: Number(x.quantity) * batches,
        unit: x.unit,
        cost: Number(x.cost) * batches,
        rate: x.rate,
        rateUnit: x.rateUnit
      })),
      additionalCostSnapshot: d.additionalCosts || [],
      notes: req.body.notes
    });
    res.status(201).json(p);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.get('/production', async (req, res) =>
  res.json(await Production.find({ userId: req.user.id }).populate('dishId', 'name').sort({ date: -1 }))
);

async function buildSale(d, userId, { quantity, returnedQuantity, sellingPrice }) {
  const q = Number(quantity);
  const returned = Number(returnedQuantity || 0);
  const price = Number(sellingPrice);
  if (!(q >= 0) || !(returned >= 0) || !(price >= 0)) throw new Error('Sale values must be 0 or greater');
  if (returned > q) throw new Error('Returned plates cannot be more than plates sold');

  const c = await costing(d, userId);
  const netQuantity = q - returned;
  const revenue = netQuantity * price;
  // Making cost covers every plate made. Returned plates are an additional return-loss cost.
  const cost = q * c.unitCost;

  return {
    dishId: d._id,
    quantity: q,
    returnedQuantity: returned,
    sellingPrice: price,
    unitCost: c.unitCost,
    revenue,
    cost,
    profit: revenue - cost
  };
}

// Daily Sales is saved as one record per dish/date. Existing rows are updated,
// so clicking Save again does not create duplicates.
r.post('/sales/bulk', async (req, res) => {
  try {
    const date = req.body.date ? parseDateInput(req.body.date) : new Date();
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const saved = [];

    for (const row of rows) {
      const q = Number(row.quantity || 0);
      const returned = Number(row.returnedQuantity || 0);
      if (q === 0 && returned === 0) continue;

      const d = await Dish.findOne({ _id: row.dishId, userId: req.user.id, active: true });
      if (!d) throw new Error('Dish not found');

      const price = row.sellingPrice === '' || row.sellingPrice === undefined
        ? (await costing(d, req.user.id)).recommendedPrice
        : Number(row.sellingPrice);

      const saleData = await buildSale(d, req.user.id, {
        quantity: q,
        returnedQuantity: returned,
        sellingPrice: price
      });

      const existing = row._id
        ? await Sale.findOne({ _id: row._id, userId: req.user.id })
        : null;

      if (existing) {
        Object.assign(existing, { ...saleData, date, notes: row.notes });
        saved.push(await existing.save());
      } else {
        const duplicate = await Sale.findOne({
          userId: req.user.id,
          dishId: d._id,
          date: { $gte: new Date(date.setHours(0,0,0,0)), $lte: new Date(date.setHours(23,59,59,999)) }
        });
        if (duplicate) {
          Object.assign(duplicate, { ...saleData, date, notes: row.notes });
          saved.push(await duplicate.save());
        } else {
          saved.push(await Sale.create({ userId: req.user.id, date, ...saleData, notes: row.notes }));
        }
      }
    }

    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.post('/sales', async (req, res) => {
  try {
    const d = await Dish.findOne({ _id: req.body.dishId, userId: req.user.id, active: true });
    if (!d) return res.status(404).json({ message: 'Dish not found' });
    const c = await costing(d, req.user.id);
    const price = req.body.sellingPrice === undefined || req.body.sellingPrice === ''
      ? c.recommendedPrice
      : Number(req.body.sellingPrice);
    const saleData = await buildSale(d, req.user.id, {
      quantity: Number(req.body.quantity),
      returnedQuantity: Number(req.body.returnedQuantity || 0),
      sellingPrice: price
    });
    res.status(201).json(await Sale.create({
      userId: req.user.id,
      date: req.body.date ? parseDateInput(req.body.date) : new Date(),
      ...saleData,
      notes: req.body.notes
    }));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.get('/sales', async (req, res) => {
  const filter = { userId: req.user.id };
  if (req.query.date) {
    const d = parseDateInput(req.query.date);
    const start = new Date(d); start.setHours(0,0,0,0);
    const end = new Date(d); end.setHours(23,59,59,999);
    filter.date = { $gte: start, $lte: end };
  }
  res.json(await Sale.find(filter).populate('dishId', 'name').sort({ date: -1 }));
});

r.put('/sales/:id', async (req, res) => {
  try {
    const s = await Sale.findOne({ _id: req.params.id, userId: req.user.id });
    if (!s) return res.status(404).json({ message: 'Sale entry not found' });
    const d = await Dish.findOne({ _id: s.dishId, userId: req.user.id });
    if (!d) return res.status(404).json({ message: 'Dish not found' });

    const c = await costing(d, req.user.id);
    const q = Number(req.body.quantity ?? s.quantity);
    const returned = Number(req.body.returnedQuantity ?? s.returnedQuantity ?? 0);
    const price = Number(req.body.sellingPrice ?? s.sellingPrice);
    if (returned > q) return res.status(400).json({ message: 'Returned plates cannot be more than plates sold' });

    const net = q - returned;
    s.quantity = q;
    s.returnedQuantity = returned;
    s.sellingPrice = price;
    s.unitCost = c.unitCost;
    s.revenue = net * price;
    // Making cost covers every plate made; returned plates create an additional loss.
    s.cost = q * c.unitCost;
    s.profit = s.revenue - s.cost;
    if (req.body.date) s.date = parseDateInput(req.body.date);
    if (req.body.notes !== undefined) s.notes = req.body.notes;
    await s.save();
    res.json(s);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.delete('/sales/:id', async (req, res) => {
  const s = await Sale.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!s) return res.status(404).json({ message: 'Sale entry not found' });
  res.json({ message: 'Sale entry permanently deleted' });
});

r.post('/expenses', async (req, res) => {
  try {
    const e = await Expense.create({
      userId: req.user.id,
      date: req.body.date ? parseDateInput(req.body.date) : new Date(),
      category: req.body.category,
      amount: Number(req.body.amount),
      notes: req.body.notes
    });
    res.status(201).json(e);
  } catch (x) {
    res.status(400).json({ message: x.message });
  }
});

r.get('/expenses', async (req, res) =>
  res.json(await Expense.find({ userId: req.user.id }).sort({ date: -1 }))
);

export default r;
