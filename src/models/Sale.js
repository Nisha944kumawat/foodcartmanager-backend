import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish', required: true },
  date: { type: Date, required: true },
  quantity: { type: Number, required: true, min: 0 },
  returnedQuantity: { type: Number, default: 0, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  unitCost: { type: Number, required: true, min: 0 },
  revenue: { type: Number, required: true, min: 0 },
  cost: { type: Number, required: true, min: 0 },
  profit: { type: Number, required: true },
  notes: String
}, { timestamps: true });

schema.index({ userId: 1, date: -1 });
schema.index({ userId: 1, dishId: 1, date: 1 });
export default mongoose.model('Sale', schema);
