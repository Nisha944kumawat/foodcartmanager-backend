import mongoose from 'mongoose';

const ingredientLine = new mongoose.Schema({
  ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ingredient', required: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true }
}, { _id: false });

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  // Legacy profit fields are kept for existing database compatibility.
  profitType: { type: String, enum: ['fixed', 'percentage'], default: 'percentage' },
  profitValue: { type: Number, default: 0, min: 0 },
  // Total pieces produced from this recipe batch.
  yieldQty: { type: Number, default: 1, min: 0.0001 },
  yieldUnit: { type: String, default: 'piece' },
  // Fixed selling price for one dish/serving.
  sellingPrice: { type: Number, default: 0, min: 0 },
  // Number of produced pieces used to make one dish/serving.
  piecesPerDish: { type: Number, default: 1, min: 0.0001 },
  ingredients: [ingredientLine],
  additionalCosts: [{ name: String, amount: { type: Number, min: 0 } }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

schema.index({ userId: 1, name: 1 }, { unique: true });
export default mongoose.model('Dish', schema);
