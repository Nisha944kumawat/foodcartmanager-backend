import { Router } from 'express';
import Ingredient from '../models/Ingredient.js';
import IngredientRate from '../models/IngredientRate.js';
import Purchase from '../models/Purchase.js';
import Dish from '../models/Dish.js';
import { auth } from '../middleware/auth.js';

const r = Router();
r.use(auth);

r.get('/', async (req, res) => {
  const data = await Ingredient.find({ userId: req.user.id, active: true }).sort({ category: 1, name: 1 });
  res.json(data);
});

r.post('/', async (req, res) => {
  try {
    const { name, category, currentRate } = req.body;
    if (!name?.trim() || !category) {
      return res.status(400).json({ message: 'Name and category are required' });
    }
    const rate = Number(currentRate);
    if (!Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ message: 'Price per kg must be 0 or greater' });
    }

    const i = await Ingredient.create({
      userId: req.user.id,
      name: name.trim(),
      category,
      baseUnit: 'kg',
      rateUnit: 'kg',
      currentRate: rate
    });

    await IngredientRate.create({
      userId: req.user.id,
      ingredientId: i._id,
      rate,
      unit: 'kg'
    });

    res.status(201).json(i);
  } catch (e) {
    res.status(400).json({ message: e.code === 11000 ? 'Ingredient already exists' : e.message });
  }
});

r.put('/:id', async (req, res) => {
  try {
    const i = await Ingredient.findOne({ _id: req.params.id, userId: req.user.id, active: true });
    if (!i) return res.status(404).json({ message: 'Ingredient not found' });

    const updates = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.currentRate !== undefined) {
      const rate = Number(req.body.currentRate);
      if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ message: 'Price per kg must be 0 or greater' });
      updates.currentRate = rate;
    }

    Object.assign(i, updates);
    await i.save();

    if (req.body.currentRate !== undefined) {
      await IngredientRate.create({
        userId: req.user.id,
        ingredientId: i._id,
        rate: i.currentRate,
        unit: 'kg'
      });
    }
    res.json(i);
  } catch (e) {
    res.status(400).json({ message: e.code === 11000 ? 'Ingredient already exists' : e.message });
  }
});

r.delete('/:id', async (req, res) => {
  try {
    const i = await Ingredient.findOne({ _id: req.params.id, userId: req.user.id });
    if (!i) return res.status(404).json({ message: 'Ingredient not found' });

    // A real delete: remove the ingredient and its editable rate/purchase records.
    // Existing production records keep their own snapshots.
    await Promise.all([
      IngredientRate.deleteMany({ userId: req.user.id, ingredientId: i._id }),
      Purchase.deleteMany({ userId: req.user.id, ingredientId: i._id }),
      Dish.updateMany(
        { userId: req.user.id },
        { $pull: { ingredients: { ingredientId: i._id } } }
      ),
      Ingredient.deleteOne({ _id: i._id, userId: req.user.id })
    ]);

    res.json({ message: 'Ingredient permanently deleted' });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.get('/:id/rates', async (req, res) => {
  res.json(await IngredientRate.find({
    userId: req.user.id,
    ingredientId: req.params.id
  }).sort({ effectiveAt: -1 }));
});

r.get('/:id/stock', async (req, res) => {
  const i = await Ingredient.findOne({ _id: req.params.id, userId: req.user.id });
  if (!i) return res.status(404).json({ message: 'Ingredient not found' });
  const purchases = await Purchase.aggregate([
    { $match: { userId: i.userId, ingredientId: i._id } },
    { $group: { _id: null, total: { $sum: '$quantity' } } }
  ]);
  res.json({ ingredient: i, purchased: purchases[0]?.total || 0 });
});

r.post('/:id/purchases', async (req, res) => {
  try {
    const i = await Ingredient.findOne({ _id: req.params.id, userId: req.user.id });
    if (!i) return res.status(404).json({ message: 'Ingredient not found' });
    const p = await Purchase.create({
      userId: req.user.id,
      ingredientId: i._id,
      date: req.body.date || new Date(),
      quantity: Number(req.body.quantity),
      unit: req.body.unit || i.baseUnit,
      amount: Number(req.body.amount),
      notes: req.body.notes
    });
    res.status(201).json(p);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default r;
