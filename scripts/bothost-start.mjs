#!/usr/bin/env node
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
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  try {
    console.log('> prisma generate');
    await run('npx', ['prisma', 'generate']);

    console.log('> prisma migrate deploy');
    await run('npx', ['prisma', 'migrate', 'deploy']);

    console.log(`> next start -H ${host} -p ${port}`);
    const child = spawn('npx', ['next', 'start', '-H', host, '-p', port], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });

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
