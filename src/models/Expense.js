import mongoose from 'mongoose';
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},date:{type:Date,required:true},category:{type:String,required:true,trim:true},amount:{type:Number,required:true,min:0},notes:String},{timestamps:true});
schema.index({userId:1,date:-1});
export default mongoose.model('Expense',schema);
