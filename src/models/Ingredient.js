import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ['vegetable', 'kitchen', 'dairy'], required: true },
  // Ingredients are managed at ₹/kg. Recipes can still consume them in g/kg.
  baseUnit: { type: String, default: 'kg', enum: ['g','kg','ml','l','piece','packet','other'] },
  openingStock: { type: Number, default: 0, min: 0 },
  minStock: { type: Number, default: 0, min: 0 },
  currentRate: { type: Number, default: 0, min: 0 },
  rateUnit: { type: String, default: 'kg', enum: ['g','kg','ml','l','piece','packet','other'] },
  active: { type: Boolean, default: true }
}, { timestamps: true });

schema.index({ userId: 1, name: 1 }, { unique: true });
export default mongoose.model('Ingredient', schema);
