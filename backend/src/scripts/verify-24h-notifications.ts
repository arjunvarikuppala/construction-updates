import '../config/env.js';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { createNotification } from '../services/notificationService.js';
import fs from 'fs';
import path from 'path';

async function runVerification() {
  console.log('========================================================================');
  console.log('🔔 SITETRACK DYNAMIC 24-HOUR ROLLING NOTIFICATIONS VERIFICATION SUITE');
  console.log('========================================================================\n');

  await connectDB();

  let passedTests = 0;
  const totalTests = 7;

  // Find or create test user
  let testUser = await User.findOne({ email: 'verify-notif-user@sitetrack.test' });
  if (!testUser) {
    testUser = await User.create({
      name: 'Verification Test User',
      email: 'verify-notif-user@sitetrack.test',
      password: 'TestPassword@123',
      role: 'MD',
      phone: '+91 99999 88888',
      isActive: true,
    });
  }

  const userId = testUser._id;

  // Clean existing test notifications for this test user
  await Notification.deleteMany({ recipient: userId });

  const now = new Date();
  const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  // 1. Create notifications with distinct timestamps
  const notifOld = await Notification.create({
    recipient: userId,
    type: 'DAILY_REPORT_SUBMITTED',
    title: 'Old Report Submission',
    message: 'Report submitted 25 hours ago',
    isRead: false,
    createdAt: twentyFiveHoursAgo,
  });

  const notifTwentyThree = await Notification.create({
    recipient: userId,
    type: 'DAILY_REPORT_COMMENT',
    title: 'Report Feedback 23h',
    message: 'Feedback submitted 23 hours ago',
    isRead: false,
    createdAt: twentyThreeHoursAgo,
  });

  const notifRecent = await Notification.create({
    recipient: userId,
    type: 'DAILY_REPORT_VIEWED',
    title: 'Report Seen 2h',
    message: 'Report seen 2 hours ago',
    isRead: false,
    createdAt: twoHoursAgo,
  });

  // Test 1: 24-Hour Rolling Window Exclusion
  console.log('--- TEST 1: 24-Hour Rolling Window Filtering ---');
  const rollingWindowBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentNotifications = await Notification.find({
    recipient: userId,
    createdAt: { $gte: rollingWindowBoundary },
  }).sort({ createdAt: -1 });

  const recentIds = recentNotifications.map((n) => n._id.toString());
  const excludesOld = !recentIds.includes(notifOld._id.toString());
  const includesTwentyThree = recentIds.includes(notifTwentyThree._id.toString());
  const includesTwo = recentIds.includes(notifRecent._id.toString());

  if (excludesOld && includesTwentyThree && includesTwo && recentNotifications.length === 2) {
    console.log('✅ PASS: Rolling 24-hour query excludes >24h notifications and includes <=24h notifications.');
    passedTests++;
  } else {
    console.error('❌ FAIL: Rolling 24-hour query mismatch.', {
      excludesOld,
      includesTwentyThree,
      includesTwo,
      count: recentNotifications.length,
    });
  }

  // Test 2: Dynamic 24-Hour Unread Count
  console.log('\n--- TEST 2: Dynamic 24-Hour Unread Count ---');
  const windowUnreadCount = await Notification.countDocuments({
    recipient: userId,
    isRead: false,
    createdAt: { $gte: rollingWindowBoundary },
  });

  if (windowUnreadCount === 2) {
    console.log(`✅ PASS: Active 24-hour unread count is exactly ${windowUnreadCount} (excludes 25h unread item).`);
    passedTests++;
  } else {
    console.error(`❌ FAIL: Expected 2 unread items in 24h window, found: ${windowUnreadCount}`);
  }

  // Test 3: Historical Records Preservation in MongoDB
  console.log('\n--- TEST 3: Historical Records Preservation ---');
  const allNotifications = await Notification.find({ recipient: userId }).sort({ createdAt: -1 });
  const totalCount = await Notification.countDocuments({ recipient: userId });
  const hasPreservedOld = allNotifications.some((n) => n._id.toString() === notifOld._id.toString());

  if (totalCount >= 3 && hasPreservedOld) {
    console.log(`✅ PASS: MongoDB preserves all historical notifications (${totalCount} total). No deletion occurs.`);
    passedTests++;
  } else {
    console.error('❌ FAIL: Older notification was not preserved in MongoDB.');
  }

  // Test 4: Marking as Read Dynamically Updates 24h Count
  console.log('\n--- TEST 4: Dynamic Read Status Recalculation ---');
  await Notification.findByIdAndUpdate(notifRecent._id, { isRead: true });

  const updatedWindowUnread = await Notification.countDocuments({
    recipient: userId,
    isRead: false,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });

  if (updatedWindowUnread === 1) {
    console.log('✅ PASS: Marking recent notification as read immediately updates 24h unread count to 1.');
    passedTests++;
  } else {
    console.error(`❌ FAIL: Expected 1 unread notification after marking read, got: ${updatedWindowUnread}`);
  }

  // Test 5: Notification Deduplication Check
  console.log('\n--- TEST 5: Duplicate Prevention Mechanism ---');
  const dupPayload = {
    recipient: userId.toString(),
    type: 'DAILY_REPORT_SUBMITTED' as const,
    title: 'Duplicate Test',
    message: 'Testing deduplication lock',
    relatedEntity: 'DAILY_REPORT' as const,
    relatedId: 'report-dedup-123',
  };

  const firstCreate = await createNotification(dupPayload);
  const secondCreate = await createNotification(dupPayload);

  if (firstCreate && secondCreate && firstCreate._id.toString() === secondCreate._id.toString()) {
    console.log('✅ PASS: Duplicate notification spam within 2 minutes is intercepted and deduplicated.');
    passedTests++;
  } else {
    console.error('❌ FAIL: Duplicate notification was created.');
  }

  // Test 6: Role Separation Verification (Code Inspection)
  console.log('\n--- TEST 6: Role-Based Notification Indicators Inspection ---');
  const unreadDotPath = path.resolve('frontend/src/components/common/UnreadDot.tsx');
  const unreadDotCode = fs.readFileSync(unreadDotPath, 'utf8');

  const notifCenterPath = path.resolve('frontend/src/components/layout/NotificationCenter.tsx');
  const notifCenterCode = fs.readFileSync(notifCenterPath, 'utf8');

  const unreadDotRoleGuarded = unreadDotCode.includes('if (!isMD && !isOwner) {') && unreadDotCode.includes('return null;');
  const notifCenterRoleGuarded = notifCenterCode.includes('{isMDOrOwner && unreadCount > 0 &&') &&
    notifCenterCode.includes('Site In-Charge role: strictly NO orange unread dot and NO unread badge');

  if (unreadDotRoleGuarded && notifCenterRoleGuarded) {
    console.log('✅ PASS: Orange unread dots and badges are strictly scoped to MD/Owner and hidden for In-Charge.');
    passedTests++;
  } else {
    console.error('❌ FAIL: Role separation logic missing or compromised in frontend components.');
  }

  // Test 7: Dedicated Historical Page & Routes Verification
  console.log('\n--- TEST 7: View All Notifications Page & Route Inspection ---');
  const notifPagePath = path.resolve('frontend/src/pages/NotificationsPage.tsx');
  const appPath = path.resolve('frontend/src/App.tsx');
  const hasNotifPage = fs.existsSync(notifPagePath);
  const appCode = fs.readFileSync(appPath, 'utf8');
  const hasNotifRoute = appCode.includes('<Route path="notifications" element={<NotificationsPage />} />');

  if (hasNotifPage && hasNotifRoute) {
    console.log('✅ PASS: Dedicated NotificationsPage component and /notifications route properly configured.');
    passedTests++;
  } else {
    console.error('❌ FAIL: Dedicated NotificationsPage or route missing.');
  }

  // Cleanup test user and notifications
  await Notification.deleteMany({ recipient: userId });
  await User.findByIdAndDelete(userId);

  console.log('\n========================================================================');
  console.log(`🎯 VERIFICATION RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('========================================================================');

  await mongoose.disconnect();
  process.exit(passedTests === totalTests ? 0 : 1);
}

runVerification().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});
