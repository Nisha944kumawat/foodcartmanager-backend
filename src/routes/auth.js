import {Router} from 'express';import bcrypt from 'bcryptjs';import jwt from 'jsonwebtoken';import User from '../models/User.js';import {auth} from '../middleware/auth.js';
const r=Router();
const token=u=>jwt.sign({id:u._id,email:u.email,name:u.name},process.env.JWT_SECRET,{expiresIn:'30d'});
r.post('/register',async(req,res)=>{try{const {name,email,password}=req.body;if(!name||!email||!password||password.length<6)return res.status(400).json({message:'Name, email and 6+ character password are required'});const exists=await User.findOne({email});if(exists)return res.status(409).json({message:'Email already registered'});const u=await User.create({name,email,passwordHash:await bcrypt.hash(password,12)});res.status(201).json({token:token(u),user:{id:u._id,name:u.name,email:u.email}})}catch(e){res.status(500).json({message:e.message})}});
r.post('/login',async(req,res)=>{try{const {email,password}=req.body;const u=await User.findOne({email});if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({message:'Invalid email or password'});res.json({token:token(u),user:{id:u._id,name:u.name,email:u.email}})}catch(e){res.status(500).json({message:e.message})}});
r.get('/me', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).select('name email');

    if (!u) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    res.json({
      user: {
        id: u._id,
        name: u.name,
        email: u.email
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);

    res.status(500).json({
      message: 'Failed to get user'
    });
  }
});
export default r;
