import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import dns from 'dns';
import { promisify } from 'util';

dotenv.config();

const dnsLookup = promisify(dns.lookup);

console.log('🔍 Testing Supabase Connection...\n');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('📋 Current Configuration:');
console.log('  SUPABASE_URL:', supabaseUrl || '❌ NOT SET');
console.log('  SUPABASE_ANON_KEY:', supabaseKey ? `${supabaseKey.substring(0, 20)}...` : '❌ NOT SET');
console.log('');

if (!supabaseUrl || !supabaseKey) {
  console.log('❌ Missing credentials! Please add them to .env file');
  process.exit(1);
}

try {
  console.log('🌐 Testing DNS resolution...');
  const urlObj = new URL(supabaseUrl);
  const hostname = urlObj.hostname;
  console.log('  Hostname:', hostname);

  try {
    const address = await dnsLookup(hostname);
    console.log('  ✅ DNS Lookup OK:', address);
  } catch (err) {
    console.log('  ❌ DNS Lookup FAILED:', err.message);
    console.log('\n💡 This means the Supabase URL is invalid or the project was deleted.');
    console.log('   Please check your Supabase dashboard: https://supabase.com/dashboard');
    console.log('   Get your credentials from: Settings → API');
    process.exit(1);
  }

  console.log('\n🔌 Testing Supabase connection...');
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { data, error } = await supabase.storage.listBuckets();
  
  if (error) {
    console.log('  ❌ Connection FAILED:', error.message);
    if (error.message.includes('Invalid API key') || error.message.includes('JWT')) {
      console.log('\n💡 Your SUPABASE_ANON_KEY is invalid. Get the correct key from:');
      console.log('   https://supabase.com/dashboard → Your Project → Settings → API');
    }
    process.exit(1);
  }
  
  console.log('  ✅ Connected successfully!');
  console.log('\n📦 Available buckets:', data?.map(b => b.name).join(', ') || 'none');
  
  const pdfsBucket = data?.find(b => b.name === 'pdfs');
  if (pdfsBucket) {
    console.log('  ✅ "pdfs" bucket exists!');
  } else {
    console.log('  ⚠️  "pdfs" bucket does NOT exist');
    console.log('   You need to create it in Supabase dashboard:');
    console.log('   Storage → New bucket → Name: "pdfs" → Public: Yes');
  }
  
  console.log('\n✅ All checks passed! Your Supabase is configured correctly.');
} catch (err) {
  console.log('  ❌ Error:', err.message);
  if (err.cause) {
    console.log('  Cause:', err.cause.message);
  }
  process.exit(1);
}


