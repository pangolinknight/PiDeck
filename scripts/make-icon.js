const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');

const out = path.join(__dirname, '..', 'build');
const iconsDir = path.join(out, 'icons');
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function renderPng(size, target) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(target);
}

async function main() {
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.svg'), svg);

  // electron-builder 在 Linux 下会从 build/icons 读取多尺寸 PNG；
  // Windows 安装包需要 .ico，macOS 需要 .icns。显式生成这些格式，
  // 避免只存在 SVG 时各平台回退到默认 Electron 图标。
  await Promise.all(
    pngSizes.map(size => renderPng(size, path.join(iconsDir, `${size}x${size}.png`))),
  );

  await fs.promises.copyFile(path.join(iconsDir, '512x512.png'), path.join(out, 'icon.png'));
  const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(size => path.join(iconsDir, `${size}x${size}.png`)));
  await fs.promises.writeFile(path.join(out, 'icon.ico'), ico);

  try {
    await sharp(Buffer.from(svg)).resize(1024, 1024).toFile(path.join(out, 'icon.icns'));
  } catch (error) {
    console.warn('skipped build/icon.icns:', error instanceof Error ? error.message : error);
  }

  console.log('wrote build/icon.svg, build/icon.png, build/icon.ico and build/icons/*.png');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
