import { HuggingFaceEmbedding } from '@llamaindex/huggingface';
import { SimpleDirectoryReader } from '@llamaindex/readers/directory';
import {
  Settings,
  VectorStoreIndex,
  storageContextFromDefaults,
} from 'llamaindex';
import * as path from 'path';
import { config } from 'dotenv';

config();

process.env.TRANSFORMERS_BACKEND = 'onnxruntime-node';

async function main() {
  console.log('🚀 Starting data ingestion...');

  Settings.embedModel = new HuggingFaceEmbedding({
    modelType: 'BAAI/bge-small-en-v1.5',
  });
  console.log('✨ Embedding model set to HuggingFace (BAAI/bge-small-en-v1.5)');

  const dataDir = path.resolve(__dirname, 'data');
  const persistDir = path.resolve(__dirname, 'storage');

  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData(dataDir);
  console.log(`✅ Loaded ${documents.length} document(s).`);

  const storageContext = await storageContextFromDefaults({ persistDir });
  console.log('⚙️ Creating index and embeddings...');

  await VectorStoreIndex.fromDocuments(documents, { storageContext });
  console.log("✅ Ingestion complete. Index saved in './storage'.");
}
main().catch(console.error);
