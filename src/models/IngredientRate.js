import mongoose from 'mongoose';
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},ingredientId:{type:mongoose.Schema.Types.ObjectId,ref:'Ingredient',required:true},rate:{type:Number,required:true,min:0},unit:{type:String,required:true},effectiveAt:{type:Date,default:Date.now}},{timestamps:true});
schema.index({ingredientId:1,effectiveAt:-1});
export default mongoose.model('IngredientRate',schema);
