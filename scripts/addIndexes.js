import mongoose from 'mongoose';
import User from '../models/User.js';
import Device from '../models/Device.js';

async function addIndexes() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // User indexes
  await User.collection.createIndex({ email: 1, isActive: 1 });
  await User.collection.createIndex({ 'pushSubscriptions.endpoint': 1 });
  await User.collection.createIndex({ 'pushSubscriptions.deviceId': 1 });
  
  // Device indexes
  await Device.collection.createIndex({ userId: 1, deviceId: 1 }, { unique: true });
  await Device.collection.createIndex({ userId: 1, isActive: 1, lastActive: -1 });
  
  console.log('Indexes added successfully');
  process.exit(0);
}

addIndexes().catch(console.error);