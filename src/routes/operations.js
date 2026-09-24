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

async function buildSale(d, userId, { platesSold, returnedQuantity }) {
  const sold = Number(platesSold);
  const returned = Number(returnedQuantity || 0);
  if (!(sold >= 0) || !(returned >= 0)) throw new Error('Sale values must be 0 or greater');

  const c = await costing(d, userId);
  const totalMade = sold + returned;
  const price = Number(d.sellingPrice || 0);
  // Plates Sell is the number entered as sold. Returns are tracked separately.
  // Return cost is informational only and is never added/subtracted again from profit.
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const netSold = Math.max(0, sold - returned);
  const revenue = round2(netSold * price);
  const makingCost = round2(sold * c.dishCost);

  return {
    dishId: d._id,
    quantity: totalMade,
    returnedQuantity: returned,
    sellingPrice: price,
    unitCost: c.dishCost,
    revenue,
    cost: makingCost,
    profit: round2(revenue - makingCost)
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
      const madeToday = row.madeToday !== false;
      const sold = madeToday ? Number(row.platesSold || 0) : 0;
      const returned = madeToday ? Number(row.returnedQuantity || 0) : 0;
      if (sold < 0 || returned < 0) throw new Error('Sale values must be 0 or greater');

      const d = await Dish.findOne({ _id: row.dishId, userId: req.user.id, active: true });
      if (!d) throw new Error('Dish not found');

      const existing = row._id
        ? await Sale.findOne({ _id: row._id, userId: req.user.id })
        : await Sale.findOne({
            userId: req.user.id,
            dishId: d._id,
            date: { $gte: new Date(new Date(date).setHours(0,0,0,0)), $lte: new Date(new Date(date).setHours(23,59,59,999)) }
          });

      if (!madeToday) {
        if (existing) {
          existing.quantity = 0;
          existing.returnedQuantity = 0;
          existing.madeToday = false;
          existing.sellingPrice = Number(d.sellingPrice || 0);
          const c = await costing(d, req.user.id);
          existing.unitCost = Number(c.dishCost || 0);
          existing.revenue = 0;
          existing.cost = 0;
          existing.profit = 0;
          existing.date = date;
          existing.notes = row.notes;
          saved.push(await existing.save());
        }
        continue;
      }

      const saleData = await buildSale(d, req.user.id, {
        platesSold: sold,
        returnedQuantity: returned
      });

      if (existing) {
        Object.assign(existing, { ...saleData, madeToday: true, date, notes: row.notes });
        saved.push(await existing.save());
      } else {
        saved.push(await Sale.create({ userId: req.user.id, date, ...saleData, madeToday: true, notes: row.notes }));
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
    const saleData = await buildSale(d, req.user.id, {
      platesSold: Number(req.body.platesSold ?? req.body.quantity ?? 0),
      returnedQuantity: Number(req.body.returnedQuantity || 0)
    });
    res.status(201).json(await Sale.create({
      userId: req.user.id,
      date: req.body.date ? parseDateInput(req.body.date) : new Date(),
      ...saleData,
      madeToday: req.body.madeToday !== false,
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

    const sold = Number(req.body.platesSold ?? Math.max(0, Number(s.quantity || 0) - Number(s.returnedQuantity || 0)));
    const returned = Number(req.body.returnedQuantity ?? s.returnedQuantity ?? 0);
    if (sold < 0 || returned < 0) return res.status(400).json({ message: 'Sale values must be 0 or greater' });

    const saleData = await buildSale(d, req.user.id, {
      platesSold: sold,
      returnedQuantity: returned
    });
    Object.assign(s, saleData);
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
