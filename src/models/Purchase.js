import mongoose from 'mongoose';
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},ingredientId:{type:mongoose.Schema.Types.ObjectId,ref:'Ingredient',required:true},date:{type:Date,required:true},quantity:{type:Number,required:true,min:0.0001},unit:{type:String,required:true},amount:{type:Number,required:true,min:0},notes:String},{timestamps:true});
schema.index({userId:1,date:-1});
export default mongoose.model('Purchase',schema);
