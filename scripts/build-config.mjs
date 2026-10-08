import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
}

const js = `// Generated during Vercel build. Do not commit secrets here.\nwindow.SUNSHINE_CONFIG = ${JSON.stringify({ supabaseUrl, supabaseKey }, null, 2)};\n`;
writeFileSync(join(process.cwd(), 'assets', 'js', 'config.js'), js, 'utf8');
console.log('Generated assets/js/config.js');
