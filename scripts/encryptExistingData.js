import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from '../models/User.js';

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
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
