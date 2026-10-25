import mongoose from 'mongoose';

let memoryServer: any = null;

function maskMongoUri(uri: string): string {
  try {
    return uri.replace(/:([^:@]+)@/, ':****@');
  } catch {
    return uri;
  }
}

export async function connectDB(): Promise<void> {
  const rawUri = process.env.MONGODB_URI;
  const uri = rawUri ? rawUri.trim() : '';

  try {
    if (uri) {
      console.log(`Connecting to MongoDB (${maskMongoUri(uri)})...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8000,
      });
      console.log('Connected successfully to MongoDB database:', mongoose.connection.name);
      console.log(`Host: ${mongoose.connection.host || 'unknown'}`);
    } else {
      console.log('No MONGODB_URI configured. Starting embedded MongoDB Memory Server for local development...');
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      const inMemoryUri = memoryServer.getUri();
      await mongoose.connect(inMemoryUri);
      console.log('Connected to embedded MongoDB Memory Server:', inMemoryUri);
    }

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB runtime connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB connection disconnected');
    });
  } catch (error: any) {
    console.error('Failed to connect to MongoDB:');
    if (uri) {
      console.error(`  URI: ${maskMongoUri(uri)}`);
      console.error(`  Error: ${error?.message || error}`);
      console.error('  Tip: Check your MongoDB URI, network connectivity, and Atlas IP Access List (whitelist 0.0.0.0/0).');
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
  }
}
