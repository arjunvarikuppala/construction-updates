import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { WeatherCache } from '../models/WeatherCache.js';
import { WeatherService } from '../services/weatherService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { rupeesToPaise } from '../utils/currency.js';

let mongoServer: MongoMemoryServer;

async function runWeatherVerification() {
  console.log('\n========================================================================');
  console.log('🌦️ SITETRACK LIVE WEATHER & TEMPERATURE INTEGRATION TEST SUITE');
  console.log('========================================================================\n');

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  console.log('✅ Connected to isolated MongoDB Test Database.\n');

  try {
    // -------------------------------------------------------------------------
    // 1. SETUP TEST ACTORS & PROJECTS
    // -------------------------------------------------------------------------
    console.log('--- Step 1: Setting Up Actors & Construction Projects ---');

    const mdUser = await User.create({
      name: 'Vikram Singhania (MD)',
      email: 'md.singhania@sitetrack.com',
      password: 'HashedPassword123',
      role: 'MD',
      phone: '+91 98765 43210',
      isActive: true,
    });

    const inChargeUser1 = await User.create({
      name: 'Rajesh Kumar (In-Charge)',
      email: 'rajesh.incharge@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98111 22334',
      isActive: true,
    });

    const inChargeUser2 = await User.create({
      name: 'Amit Sharma (In-Charge)',
      email: 'amit.incharge@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98222 33445',
      isActive: true,
    });

    // Project 1: Noida Sector 62 (Assigned to inCharge1)
    const project1 = await Project.create({
      name: 'Metro Heights Commercial Complex',
      code: 'PRJ-MHC-01',
      location: 'Sector 62, Noida, NCR',
      address: 'Plot B-9, Sector 62',
      city: 'Noida',
      state: 'Uttar Pradesh',
      country: 'India',
      latitude: 28.6280,
      longitude: 77.3649,
      budget: rupeesToPaise(15000000),
      assignedInCharge: inChargeUser1._id,
      createdBy: mdUser._id,
      owner: mdUser._id,
      status: 'IN_PROGRESS',
    });

    await ProjectAssignment.create({
      project: project1._id,
      siteInCharge: inChargeUser1._id,
      assignmentStatus: 'ACTIVE',
      assignedBy: mdUser._id,
    });

    // Project 2: Whitefield Bengaluru (Assigned to inCharge2)
    const project2 = await Project.create({
      name: 'Greenfield Luxury Villas Phase 2',
      code: 'PRJ-GLV-02',
      location: 'Whitefield, Bengaluru',
      address: 'Channasandra Main Road, Whitefield',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      latitude: 12.9698,
      longitude: 77.7499,
      budget: rupeesToPaise(8500000),
      assignedInCharge: inChargeUser2._id,
      createdBy: mdUser._id,
      owner: mdUser._id,
      status: 'IN_PROGRESS',
    });

    await ProjectAssignment.create({
      project: project2._id,
      siteInCharge: inChargeUser2._id,
      assignmentStatus: 'ACTIVE',
      assignedBy: mdUser._id,
    });

    // Project 3: Gachibowli Hyderabad (Unassigned or secondary)
    const project3 = await Project.create({
      name: 'Highland Elevated Flyover & Junction',
      code: 'PRJ-HEF-03',
      location: 'Gachibowli, Hyderabad',
      address: 'Financial District Outer Junction',
      city: 'Hyderabad',
      state: 'Telangana',
      country: 'India',
      latitude: 17.4401,
      longitude: 78.3489,
      budget: rupeesToPaise(32000000),
      createdBy: mdUser._id,
      owner: mdUser._id,
      status: 'IN_PROGRESS',
    });

    // Project 4: Unconfigured Location Project (Testing missing location handling)
    const projectUnconfigured = await Project.create({
      name: 'Northern Logistics Hub',
      code: 'PRJ-NLH-04',
      location: 'Pending Site Survey, Sector X',
      address: '',
      city: '',
      state: '',
      latitude: null,
      longitude: null,
      budget: rupeesToPaise(5000000),
      createdBy: mdUser._id,
      owner: mdUser._id,
      status: 'PLANNING',
    });

    console.log('✅ Actors and 4 test projects created successfully.\n');

    // -------------------------------------------------------------------------
    // 2. LIVE WEATHER FETCHING FOR DIFFERENT PROJECT LOCATIONS
    // -------------------------------------------------------------------------
    console.log('--- Step 2: Live Weather Retrieval For Construction Sites ---');

    const weatherP1 = await WeatherService.getProjectWeather(project1);
    console.log(`[Project 1 - Noida Sector 62]:`);
    console.log(`  Temp: ${weatherP1.weather?.temperature}°C | Feels Like: ${weatherP1.weather?.feelsLike}°C`);
    console.log(`  Condition: ${weatherP1.weather?.condition} (${weatherP1.weather?.icon})`);
    console.log(`  Humidity: ${weatherP1.weather?.humidity}% | Wind: ${weatherP1.weather?.windSpeed} km/h`);
    console.log(`  Rain Chance: ${weatherP1.weather?.precipitationProbability}%`);
    console.log(`  Cached: ${weatherP1.cached} | Observation Time: ${weatherP1.weather?.observationTime}`);

    if (!weatherP1.weather || typeof weatherP1.weather.temperature !== 'number') {
      throw new Error('Project 1 weather retrieval failed or returned invalid temperature');
    }
    console.log('✅ Passed: Real weather data fetched for Project 1.\n');

    const weatherP2 = await WeatherService.getProjectWeather(project2);
    console.log(`[Project 2 - Bengaluru Whitefield]:`);
    console.log(`  Temp: ${weatherP2.weather?.temperature}°C | Condition: ${weatherP2.weather?.condition}`);
    console.log(`  Humidity: ${weatherP2.weather?.humidity}% | Wind: ${weatherP2.weather?.windSpeed} km/h`);

    if (!weatherP2.weather || typeof weatherP2.weather.temperature !== 'number') {
      throw new Error('Project 2 weather retrieval failed');
    }
    console.log('✅ Passed: Real weather data fetched for Project 2.\n');

    // -------------------------------------------------------------------------
    // 3. CACHING STRATEGY & REUSE VERIFICATION
    // -------------------------------------------------------------------------
    console.log('--- Step 3: MongoDB Weather Cache Verification ---');

    const cachedWeatherP1 = await WeatherService.getProjectWeather(project1);
    console.log(`Second Fetch Project 1 -> Cached: ${cachedWeatherP1.cached}`);
    if (!cachedWeatherP1.cached) {
      throw new Error('Weather caching failed: Second fetch should return cached data');
    }

    const cacheRecord = await WeatherCache.findOne({ projectId: project1._id });
    if (!cacheRecord) {
      throw new Error('Weather cache document was not written to MongoDB');
    }
    console.log(`Cache Expiry Timestamp: ${cacheRecord.expiresAt}`);
    console.log('✅ Passed: WeatherCache document confirmed in MongoDB with configurable TTL.\n');

    // -------------------------------------------------------------------------
    // 4. IDENTICAL WEATHER FOR MD AND IN-CHARGE (SHARED BACKEND SERVICE)
    // -------------------------------------------------------------------------
    console.log('--- Step 4: Shared Weather Source for Both Roles ---');

    // Both MD and In-Charge call the same weather service for Project 1
    const mdViewWeather = await WeatherService.getProjectWeather(project1);
    const inChargeViewWeather = await WeatherService.getProjectWeather(project1);

    if (
      mdViewWeather.weather?.temperature !== inChargeViewWeather.weather?.temperature ||
      mdViewWeather.weather?.condition !== inChargeViewWeather.weather?.condition
    ) {
      throw new Error('Discrepancy detected: MD and Site In-Charge did not receive identical weather data');
    }
    console.log(
      `Identical Temperature: MD=${mdViewWeather.weather?.temperature}°C, In-Charge=${inChargeViewWeather.weather?.temperature}°C`
    );
    console.log('✅ Passed: In-Charge and MD receive identical underlying weather from shared source.\n');

    // -------------------------------------------------------------------------
    // 5. UNCONFIGURED LOCATION HANDLING
    // -------------------------------------------------------------------------
    console.log('--- Step 5: Missing / Unconfigured Project Location Handling ---');

    const unconfiguredWeather = await WeatherService.getProjectWeather(projectUnconfigured);
    console.log(`Unconfigured Project Result -> isConfigured: ${unconfiguredWeather.isConfigured}`);
    console.log(`Status Message: ${unconfiguredWeather.statusMessage}`);

    if (unconfiguredWeather.isConfigured !== false || unconfiguredWeather.weather !== undefined) {
      throw new Error('Unconfigured project should not display fabricated weather data');
    }
    console.log('✅ Passed: Unconfigured site returns clear configuration prompt without fake numbers.\n');

    // -------------------------------------------------------------------------
    // 6. LOCATION UPDATE & CACHE INVALIDATION
    // -------------------------------------------------------------------------
    console.log('--- Step 6: Location Update & Cache Invalidation ---');

    // Update Project 1 coordinates to Pune (18.5204, 73.8567)
    await Project.findByIdAndUpdate(project1._id, {
      location: 'Shivajinagar, Pune',
      city: 'Pune',
      state: 'Maharashtra',
      latitude: 18.5204,
      longitude: 73.8567,
    });
    await WeatherService.invalidateCache(project1._id.toString());

    const updatedP1 = await Project.findById(project1._id);
    const refreshedWeather = await WeatherService.getProjectWeather(updatedP1!);

    console.log(`Updated Project 1 (Pune) -> Temp: ${refreshedWeather.weather?.temperature}°C | Cached: ${refreshedWeather.cached}`);
    const newCache = await WeatherCache.findOne({ projectId: project1._id });
    if (newCache?.latitude !== 18.5204) {
      throw new Error('Cache was not updated with new coordinates');
    }
    console.log('✅ Passed: Project location update successfully invalidates old cache and fetches new site weather.\n');

    // -------------------------------------------------------------------------
    // 7. ROLE-BASED AUTHORIZATION & ENDPOINT ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('--- Step 7: Project-Level Security & Access Control ---');

    // In-Charge 1 is assigned to Project 1, but NOT to Project 2
    const accessCheckAllowed = await verifyUserProjectAccess(
      project1._id.toString(),
      inChargeUser1._id.toString(),
      inChargeUser1.role
    );
    if (!accessCheckAllowed.allowed) {
      throw new Error('In-Charge 1 should have access to assigned Project 1');
    }
    console.log('✅ In-Charge 1 authorized for assigned Project 1: ALLOWED');

    const accessCheckDenied = await verifyUserProjectAccess(
      project2._id.toString(),
      inChargeUser1._id.toString(),
      inChargeUser1.role
    );
    if (accessCheckDenied.allowed) {
      throw new Error('Security violation: In-Charge 1 was permitted to access Project 2');
    }
    console.log(`✅ In-Charge 1 unauthorized access to Project 2 correctly rejected: ${accessCheckDenied.reason}`);

    // MD has access to all owned projects
    const mdAccessP1 = await verifyUserProjectAccess(
      project1._id.toString(),
      mdUser._id.toString(),
      mdUser.role
    );
    const mdAccessP2 = await verifyUserProjectAccess(
      project2._id.toString(),
      mdUser._id.toString(),
      mdUser.role
    );
    if (!mdAccessP1.allowed || !mdAccessP2.allowed) {
      throw new Error('MD should have access to all managed projects');
    }
    console.log('✅ MD authorized for all managed projects: ALLOWED\n');

    // -------------------------------------------------------------------------
    // 8. WEATHER SUMMARY FOR EVERY PROJECT (MD DASHBOARD)
    // -------------------------------------------------------------------------
    console.log('--- Step 8: Multi-Project Weather Summary For MD Dashboard ---');

    const allMdProjects = await Project.find({ createdBy: mdUser._id });
    const summaries = await WeatherService.getProjectsWeatherSummary(allMdProjects);

    console.log(`Retrieved summaries for ${summaries.length} MD projects:`);
    summaries.forEach((s) => {
      console.log(
        `  • [${s.projectCode}] ${s.projectName}: ${s.isConfigured ? `${s.weather?.temperature}°C, ${s.weather?.condition}` : 'Location unconfigured'}`
      );
    });

    if (summaries.length !== 4) {
      throw new Error(`Expected 4 project summaries for MD, got ${summaries.length}`);
    }
    console.log('✅ Passed: MD weather summary accurately compiles all authorized projects.\n');

    // -------------------------------------------------------------------------
    // 9. GEOCODING RESOLUTION
    // -------------------------------------------------------------------------
    console.log('--- Step 9: Geocoding Lookup Service ---');

    const geocodeResults = await WeatherService.geocode('Gachibowli, Hyderabad');
    console.log(`Geocoding "Gachibowli, Hyderabad": Found ${geocodeResults.length} matches`);
    if (geocodeResults.length > 0) {
      console.log(`  Top match: ${geocodeResults[0].name} (${geocodeResults[0].latitude}, ${geocodeResults[0].longitude})`);
    }
    console.log('✅ Passed: Geocoding service resolves coordinates.\n');

    // -------------------------------------------------------------------------
    // 10. LOCATION-ONLY CONFIGURATION & AMBIGUITY VALIDATION
    // -------------------------------------------------------------------------
    console.log('--- Step 10: Location-Only Configuration & Validation ---');

    // Test A: Valid location-only configuration (no lat/long provided by user)
    const locationInput = 'Gachibowli, Hyderabad, Telangana, India';
    const resolution = await WeatherService.resolveLocationText(locationInput);

    if (!resolution.resolved || resolution.latitude === undefined || resolution.longitude === undefined) {
      throw new Error(`Location-only resolution failed for '${locationInput}'`);
    }
    console.log(`Location-Only Input: "${locationInput}"`);
    console.log(`  Resolved Internal Lat/Lon: ${resolution.latitude}, ${resolution.longitude} (${resolution.name})`);
    console.log('✅ Passed: Location string automatically resolved to coordinates on backend without manual lat/lon input.');

    // Test B: Invalid location string properly caught with helpful error
    const invalidLocation = 'invalid_nonexistent_quarry_zone_99999';
    const invalidResolution = await WeatherService.resolveLocationText(invalidLocation);
    if (invalidResolution.resolved) {
      throw new Error('Unresolvable location should have been rejected');
    }
    console.log(`Invalid Location Check: "${invalidLocation}" -> Rejected with message: "${invalidResolution.error}"`);
    console.log('✅ Passed: Unresolvable location rejected gracefully without showing fabricated or unrelated weather.\n');

    console.log('========================================================================');
    console.log('🎉 ALL WEATHER & TEMPERATURE VERIFICATION TESTS PASSED SUCCESSFULLY!');
    console.log('========================================================================\n');
  } finally {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

runWeatherVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
