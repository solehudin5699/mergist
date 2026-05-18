import { c } from './constants.js';

const BANNER_LINES = [
  '                     _    _   ',
  '  _ __  ___ _ _ __ _(_)__| |_ ',
  " | '  \\/ -_) '_/ _` | (_-<  _|",
  ' |_|_|_\\___|_| \\__, |_/__/\\__|',
  '               |___/          ',
];

const GRADIENT_COLORS = [51, 45, 39, 33, 27];
const SPINNER_FRAMES = ['◒', '◐', '◓', '◑'];
const DOTS = ['   ', '.  ', '.. ', '...'];
const TOTAL_LINES = BANNER_LINES.length + 2;

function render(colors: number[], frameIdx: number, status: string): void {
  for (let i = 0; i < BANNER_LINES.length; i++) {
    console.log(`\x1b[1;38;5;${colors[i]}m${BANNER_LINES[i]}\x1b[0m`);
  }
  console.log('');
  process.stdout.write(`\x1b[K${c.cyan(`${SPINNER_FRAMES[frameIdx]} ${status}`)}\n`);
}

export function printBanner(): void {
  if (!process.stdout.isTTY) return;
  for (let i = 0; i < BANNER_LINES.length; i++) {
    console.log(`\x1b[1;38;5;${GRADIENT_COLORS[i]}m${BANNER_LINES[i]}\x1b[0m`);
  }
  console.log('');
}

export function startBreathing(status: string): {
  stop: (finalStatus: string) => void;
} {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${status}\n`);
    return { stop: () => {} };
  }

  let colorShift = 0;
  let frameIdx = 0;
  let dotTick = 0;
  let stopped = false;

  render(GRADIENT_COLORS, frameIdx, status);

  const timer = setInterval(() => {
    colorShift = (colorShift + 1) % GRADIENT_COLORS.length;
    frameIdx = (frameIdx + 1) % SPINNER_FRAMES.length;
    dotTick = (dotTick + 1) % 12;
    const dots = DOTS[Math.floor(dotTick / 3)];
    const statusText = `${status}${dots}`;
    const colors = GRADIENT_COLORS.slice(colorShift).concat(GRADIENT_COLORS.slice(0, colorShift));
    process.stdout.write(`\r\x1b[${TOTAL_LINES}A`);
    render(colors, frameIdx, statusText);
  }, 200);

  return {
    stop: (finalStatus: string) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write(`\r\x1b[${TOTAL_LINES}A`);
      render(GRADIENT_COLORS, 0, finalStatus);
    },
  };
}
