import { Router } from 'express';
import Dish from '../models/Dish.js';
import Ingredient from '../models/Ingredient.js';
import { auth } from '../middleware/auth.js';
import { normalizeRate } from '../utils.js';

const r = Router();
r.use(auth);

async function costing(d, userId) {
  // ingredientId can be either:
  // 1. a normal MongoDB ObjectId/string
  // 2. a populated Ingredient object
  const ids = d.ingredients.map(x => {
    return x.ingredientId?._id || x.ingredientId;
  });

  const ings = await Ingredient.find({
    userId,
    _id: { $in: ids },
    active: true
  });

  const map = new Map(
    ings.map(i => [String(i._id), i])
  );

  let ingredientCost = 0;

  const lines = d.ingredients.map(x => {
    // Always extract the real ID
    const ingredientId =
      x.ingredientId?._id || x.ingredientId;

    const i = map.get(String(ingredientId));

    if (!i) {
      throw new Error(
        `Ingredient not found in recipe: ${ingredientId}`
      );
    }

    const rate = normalizeRate(
      i.currentRate,
      i.rateUnit,
      x.unit
    );

    const cost =
      Number(x.quantity) * rate;

    ingredientCost += cost;

    return {
      ...(x.toObject?.() ?? x),
      ingredientId: i._id,
      name: i.name,
      rate,
      rateUnit: i.rateUnit,
      cost
    };
  });

  const additional = (d.additionalCosts || []).reduce(
    (sum, x) => sum + Number(x.amount || 0),
    0
  );

  const total = ingredientCost + additional;

  const unitCost =
    d.yieldQty > 0
      ? total / d.yieldQty
      : total;

  const targetProfit =
    Number(d.profitValue || 0);

  // Recommended selling price is calculated automatically.
  // It is NOT entered/stored as a dish field.
  //
  // Fixed:
  // cost + fixed profit
  //
  // Percentage:
  // cost + (cost × percentage / 100)
  const recommendedPrice =
    d.profitType === 'fixed'
      ? unitCost + targetProfit
      : unitCost * (1 + targetProfit / 100);

  return {
    ingredientCost,
    additionalCost: additional,
    totalCost: total,
    unitCost,
    targetProfit,
    profitType: d.profitType,
    profitValue: targetProfit,
    recommendedPrice,
    lines
  };
}

r.get('/', async (req, res) => {
  const ds = await Dish.find({
    userId: req.user.id,
    active: true
  }).populate('ingredients.ingredientId', 'name currentRate rateUnit category').sort({ name: 1 });
  const withPrices = await Promise.all(ds.map(async d => ({
    ...d.toObject(),
    recommendedPrice: (await costing(d, req.user.id)).recommendedPrice
  })));
  res.json(withPrices);
});

r.get('/:id/cost', async (req, res) => {
  try {
    const d = await Dish.findOne({ _id: req.params.id, userId: req.user.id, active: true });
    if (!d) return res.status(404).json({ message: 'Dish not found' });
    res.json(await costing(d, req.user.id));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.post('/', async (req, res) => {
  try {
    const body = {
      userId: req.user.id,
      name: req.body.name,
      profitType: req.body.profitType || 'percentage',
      profitValue: Number(req.body.profitValue) || 0,
      yieldQty: Number(req.body.yieldQty) || 1,
      yieldUnit: req.body.yieldUnit || 'piece',
      ingredients: req.body.ingredients || [],
      additionalCosts: req.body.additionalCosts || []
    };

    if (!body.name?.trim()) return res.status(400).json({ message: 'Dish name is required' });
    if (!body.ingredients.length) return res.status(400).json({ message: 'Add at least one ingredient' });

    const d = await Dish.create(body);
    const result = await costing(d, req.user.id);
    res.status(201).json({ ...d.toObject(), costing: result });
  } catch (e) {
    res.status(400).json({ message: e.code === 11000 ? 'Dish already exists' : e.message });
  }
});

r.put('/:id', async (req, res) => {
  try {
    const d = await Dish.findOne({ _id: req.params.id, userId: req.user.id, active: true });
    if (!d) return res.status(404).json({ message: 'Dish not found' });

    const allowed = ['name', 'profitType', 'profitValue', 'yieldQty', 'yieldUnit', 'ingredients', 'additionalCosts'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) d[key] = req.body[key];
    }
    await d.save();

    const result = await costing(d, req.user.id);
    res.json({ ...d.toObject(), costing: result });
  } catch (e) {
    res.status(400).json({ message: e.code === 11000 ? 'Dish already exists' : e.message });
  }
});

r.delete('/:id', async (req, res) => {
  try {
    const d = await Dish.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!d) return res.status(404).json({ message: 'Dish not found' });
    res.json({ message: 'Dish permanently deleted' });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export { costing };
export default r;
