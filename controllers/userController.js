// controllers/userController.js
import User from '../models/User.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import logger from '../config/logger.js';

export const updateUserSettings = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const settingsUpdates = req.body;

    // A simple whitelist of allowed settings to prevent unwanted updates
    const allowedSettings = [
        'theme', 
        'reminderSoundEnabled', 
        'reminderVibrationEnabled', 
        'reminderSoundUrl'
        // Add other frontend-configurable settings here in the future
    ];

    const finalUpdates = {};
    for (const key in settingsUpdates) {
        if (allowedSettings.includes(key)) {
            finalUpdates[`settings.${key}`] = settingsUpdates[key];
        }
    }

    if (Object.keys(finalUpdates).length === 0) {
        return next(new AppError('No valid settings provided for update.', 400));
    }

    const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: finalUpdates },
        { new: true, runValidators: true }
    );

    if (!updatedUser) {
        return next(new AppError('User not found.', 404));
    }

    logger.info('User settings updated', { userId, updates: Object.keys(finalUpdates) });
    res.status(200).json({
        message: 'Settings updated successfully',
        settings: updatedUser.settings
    });
});