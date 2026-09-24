import { Router } from 'express';
import Sale from '../models/Sale.js';
import Dish from '../models/Dish.js';
import ActualProfitIngredient from '../models/ActualProfitIngredient.js';
import { auth } from '../middleware/auth.js';
import { parseDateInput, startOfDay, endOfDay } from '../utils.js';
import { costing } from './dishes.js';

const r = Router();
r.use(auth);

const round2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function monthRange(month) {
  const now = new Date();
  const value = /^\d{4}-\d{2}$/.test(String(month || ''))
    ? String(month)
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = value.split('-').map(Number);
  const first = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const last = new Date(year, mon, 0, 23, 59, 59, 999);
  return { month: value, from: first, to: last };
}

function yearRange(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1970 || y > 2100) throw new Error('Invalid year');
  return {
    year: y,
    from: new Date(y, 0, 1, 0, 0, 0, 0),
    to: new Date(y, 11, 31, 23, 59, 59, 999)
  };
}

function saleNumbers(x) {
  const quantity = Number(x.quantity || 0);
  const returned = Number(x.returnedQuantity || 0);
  const price = Number(x.sellingPrice || 0);
  const unitCost = Number(x._calculatedUnitCost ?? x.unitCost ?? 0);
  // Sale.quantity stores plates made/sold input + returned plates.
  // Therefore platesMade (the user's Plates Made/Sell value) is quantity - returned.
  const platesMade = Math.max(0, quantity - returned);
  const netSold = Math.max(0, platesMade - returned);
  const sales = round2(netSold * price);
  const makingCost = round2(platesMade * unitCost);
  const profit = round2(sales - makingCost);
  return { quantity, returned, price, unitCost, platesMade, netSold, sales, makingCost, profit };
}

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function prepareSales(userId, from, to) {
  const sales = await Sale.find({ userId, date: { $gte: from, $lte: to } }).populate('dishId', 'name');
  const dishIds = [...new Set(sales.map(s => String(s.dishId?._id || s.dishId)).filter(Boolean))];
  if (!dishIds.length) return sales;
  const dishDocs = await Dish.find({ userId, _id: { $in: dishIds } });
  const costMap = new Map();
  await Promise.all(dishDocs.map(async d => {
    const c = await costing(d, userId);
    costMap.set(String(d._id), Number(c.dishCost || 0));
  }));
  sales.forEach(s => {
    const id = String(s.dishId?._id || s.dishId);
    if (costMap.has(id)) s._calculatedUnitCost = costMap.get(id);
  });
  return sales;
}

async function ingredientTotals(userId, from, to) {
  const fromMonth = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  const toMonth = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}`;
  const items = await ActualProfitIngredient.find({ userId, month: { $gte: fromMonth, $lte: toMonth } });
  const map = new Map();
  items.forEach(item => map.set(item.month, round2((map.get(item.month) || 0) + Number(item.price || 0))));
  return map;
}

async function monthlyActualProfit(userId, month) {
  const { from, to } = monthRange(month);
  const [sales, items] = await Promise.all([
    prepareSales(userId, from, to),
    ActualProfitIngredient.find({ userId, month }).sort({ createdAt: 1 })
  ]);
  const netProfit = round2(sales.reduce((sum, sale) => sum + saleNumbers(sale).profit, 0));
  const totalIngredientPrice = round2(items.reduce((sum, item) => sum + Number(item.price || 0), 0));
  return {
    month,
    netProfit,
    totalIngredientPrice,
    actualProfit: round2(netProfit - totalIngredientPrice)
  };
}

// Existing monthly Actual Profit page data + ingredient list.
r.get('/', async (req, res) => {
  try {
    const { month, from, to } = monthRange(req.query.month);
    const [items, netProfit] = await Promise.all([
      ActualProfitIngredient.find({ userId: req.user.id, month }).sort({ createdAt: 1 }),
      prepareSales(req.user.id, from, to)
    ]);
    const monthlyNet = round2(netProfit.reduce((sum, sale) => sum + saleNumbers(sale).profit, 0));
    const totalIngredientPrice = round2(items.reduce((sum, item) => sum + Number(item.price || 0), 0));
    const actualProfit = round2(monthlyNet - totalIngredientPrice);
    res.json({ month, range: { from, to }, netProfit: monthlyNet, items, totalIngredientPrice, actualProfit });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Day-wise profit for the selected month. Ingredient expenses are intentionally
// not subtracted here: those expenses are monthly Actual Profit adjustments.
r.get('/days', async (req, res) => {
  try {
    const { month, from, to } = monthRange(req.query.month);
    const sales = await prepareSales(req.user.id, from, to);
    const map = new Map();
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      map.set(key, { date: key, day: d.toLocaleDateString('en-US', { weekday: 'long' }), profit: 0 });
    }
    sales.forEach(sale => {
      const key = dayKey(sale.date);
      const row = map.get(key);
      if (row) row.profit = round2(row.profit + saleNumbers(sale).profit);
    });
    res.json({ month, days: [...map.values()] });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// All months of a selected year. Actual Profit = monthly Net Profit/Loss -
// ingredient prices entered for that exact month.
r.get('/months', async (req, res) => {
  try {
    const { year, from, to } = yearRange(req.query.year || new Date().getFullYear());
    const [sales, ingredientMap] = await Promise.all([
      prepareSales(req.user.id, from, to),
      ingredientTotals(req.user.id, from, to)
    ]);
    const profitMap = new Map();
    sales.forEach(sale => {
      const key = monthKey(sale.date);
      profitMap.set(key, round2((profitMap.get(key) || 0) + saleNumbers(sale).profit));
    });
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const netProfit = round2(profitMap.get(key) || 0);
      const totalIngredientPrice = round2(ingredientMap.get(key) || 0);
      months.push({
        month: key,
        monthName: new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'long' }),
        netProfit,
        totalIngredientPrice,
        actualProfit: round2(netProfit - totalIngredientPrice)
      });
    }
    res.json({ year, months, yearActualProfit: round2(months.reduce((sum, x) => sum + x.actualProfit, 0)) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Year-wise Actual Profit for a selected year range. Each year's value is the
// sum of its 12 monthly Actual Profit values.
r.get('/years', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const fromYear = Number(req.query.from || currentYear);
    const toYear = Number(req.query.to || fromYear);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear < 1970 || toYear > 2100 || fromYear > toYear) {
      return res.status(400).json({ message: 'Invalid year range' });
    }
    const from = new Date(fromYear, 0, 1, 0, 0, 0, 0);
    const to = new Date(toYear, 11, 31, 23, 59, 59, 999);
    const [sales, ingredientMap] = await Promise.all([
      prepareSales(req.user.id, from, to),
      ingredientTotals(req.user.id, from, to)
    ]);
    const netByMonth = new Map();
    sales.forEach(sale => {
      const key = monthKey(sale.date);
      netByMonth.set(key, round2((netByMonth.get(key) || 0) + saleNumbers(sale).profit));
    });
    const years = [];
    for (let y = fromYear; y <= toYear; y++) {
      let netProfit = 0;
      let ingredientTotal = 0;
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        netProfit += Number(netByMonth.get(key) || 0);
        ingredientTotal += Number(ingredientMap.get(key) || 0);
      }
      netProfit = round2(netProfit);
      ingredientTotal = round2(ingredientTotal);
      years.push({ year: y, netProfit, totalIngredientPrice: ingredientTotal, actualProfit: round2(netProfit - ingredientTotal) });
    }
    res.json({ fromYear, toYear, years });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.post('/', async (req, res) => {
  try {
    const { month } = monthRange(req.body.month);
    const name = String(req.body.name || '').trim();
    const price = Number(req.body.price);
    if (!name) return res.status(400).json({ message: 'Ingredient name is required' });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: 'Ingredient price must be 0 or greater' });
    const item = await ActualProfitIngredient.create({ userId: req.user.id, month, name, price: round2(price) });
    res.status(201).json(item);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.put('/:id', async (req, res) => {
  try {
    const item = await ActualProfitIngredient.findOne({ _id: req.params.id, userId: req.user.id });
    if (!item) return res.status(404).json({ message: 'Actual profit ingredient not found' });
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ message: 'Ingredient name is required' });
      item.name = name;
    }
    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: 'Ingredient price must be 0 or greater' });
      item.price = round2(price);
    }
    if (req.body.month !== undefined) item.month = monthRange(req.body.month).month;
    await item.save();
    res.json(item);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.delete('/:id', async (req, res) => {
  try {
    const item = await ActualProfitIngredient.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!item) return res.status(404).json({ message: 'Actual profit ingredient not found' });
    res.json({ message: 'Actual profit ingredient deleted' });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default r;
