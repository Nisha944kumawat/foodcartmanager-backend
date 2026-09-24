import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 }
}, { timestamps: true });

schema.index({ userId: 1, month: 1, createdAt: -1 });
export default mongoose.model('ActualProfitIngredient', schema);
