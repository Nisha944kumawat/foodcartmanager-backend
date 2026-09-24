import { Router } from 'express';
import Dish from '../models/Dish.js';
import Ingredient from '../models/Ingredient.js';
import { auth } from '../middleware/auth.js';
import { normalizeRate } from '../utils.js';

const r = Router();
r.use(auth);

async function costing(d, userId) {
  const ids = d.ingredients.map(x => x.ingredientId?._id || x.ingredientId);
  const ings = await Ingredient.find({ userId, _id: { $in: ids }, active: true });
  const map = new Map(ings.map(i => [String(i._id), i]));

  let ingredientCost = 0;
  const lines = d.ingredients.map(x => {
    const ingredientId = x.ingredientId?._id || x.ingredientId;
    const i = map.get(String(ingredientId));
    if (!i) throw new Error(`Ingredient not found in recipe: ${ingredientId}`);
    const rate = normalizeRate(i.currentRate, i.rateUnit, x.unit);
    const cost = Number(x.quantity) * rate;
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

  const additional = (d.additionalCosts || []).reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const total = ingredientCost + additional;
  const totalPieces = Number(d.yieldQty || 0);
  const piecesPerDish = Number(d.piecesPerDish || 1);
  const costPerPiece = totalPieces > 0 ? total / totalPieces : total;
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const dishCost = round2(costPerPiece * piecesPerDish);
  const sellingPrice = Number(d.sellingPrice || 0);
  const profitLoss = Math.round((sellingPrice - dishCost + Number.EPSILON) * 100) / 100;

  return {
    ingredientCost: round2(ingredientCost),
    additionalCost: round2(additional),
    totalCost: round2(total),
    totalPieces,
    costPerPiece: round2(costPerPiece),
    piecesPerDish,
    dishCost,
    sellingPrice,
    profitLoss: round2(profitLoss),
    lines
  };
}

r.get('/', async (req, res) => {
  const ds = await Dish.find({
    userId: req.user.id,
    active: true
  }).populate('ingredients.ingredientId', 'name currentRate rateUnit category').sort({ name: 1 });
  const withCosts = await Promise.all(ds.map(async d => ({
    ...d.toObject(),
    costing: await costing(d, req.user.id)
  })));
  res.json(withCosts);
  return;
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
      // Legacy profit fields remain stored only for compatibility; they are no longer used.
      yieldQty: Number(req.body.yieldQty) || 1,
      yieldUnit: req.body.yieldUnit || 'piece',
      sellingPrice: Number(req.body.sellingPrice) || 0,
      piecesPerDish: Number(req.body.piecesPerDish) || 1,
      ingredients: req.body.ingredients || [],
      additionalCosts: req.body.additionalCosts || []
    };

    if (!body.name?.trim()) return res.status(400).json({ message: 'Dish name is required' });
    if (!body.ingredients.length) return res.status(400).json({ message: 'Add at least one ingredient' });
    if (!(body.yieldQty > 0)) return res.status(400).json({ message: 'Total pieces made must be greater than zero' });
    if (!(body.piecesPerDish > 0)) return res.status(400).json({ message: 'Pieces used per dish must be greater than zero' });
    if (!(body.sellingPrice >= 0)) return res.status(400).json({ message: 'Selling price must be 0 or greater' });

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

    const allowed = ['name', 'yieldQty', 'yieldUnit', 'sellingPrice', 'piecesPerDish', 'ingredients', 'additionalCosts'];
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
