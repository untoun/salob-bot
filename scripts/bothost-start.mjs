#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const port = process.env.PORT || '3000';
const host = process.env.HOSTNAME || '0.0.0.0';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  try {
    await run('npx', ['prisma', 'generate']);
    await run('npx', ['prisma', 'migrate', 'deploy']);

    // Some Bothost configurations run the start command in a fresh runtime
    // container and do not retain the build layer. Build on startup if the
    // production artifact is missing instead of starting a broken server.
    if (!existsSync('.next/BUILD_ID')) {
      console.log('Next production build is missing; running npm run build');
      await run('npm', ['run', 'build']);
    }

    const child = spawn('npx', ['next', 'start', '-H', host, '-p', port], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', (error) => {
      console.error(error);
      process.exit(1);
    });
  } catch (error) {
    console.error('Bothost bootstrap failed');
    console.error(error);
    process.exit(1);
  }
}

main();
