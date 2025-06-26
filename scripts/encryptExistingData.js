import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../backend/models/User.js';

dotenv.config();

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({});
  for (const user of users) {
    user.markModified('notesTree');
    await user.save();
    console.log(`Encrypted data for user ${user._id}`);
  }
  process.exit();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});