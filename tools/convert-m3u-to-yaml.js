#!/usr/bin/env node
//
// One-time conversion: fetch the remote M3U playlist, parse it, apply
// exclusion rules + supplemental channels, and output channels.yaml.
//
// Usage:  node tools/convert-m3u-to-yaml.js > channels.yaml
//

const M3U_URL =
  'https://raw.githubusercontent.com/renanbazinin/myM3U/main/directLiveNamesDiffandEPG1.m3u';

const MAKO_IFRAME_URL =
  'https://www.mako.co.il/AjaxPage?jspName=embedHTML5video.jsp' +
  '&galleryChannelId=7c5076a9b8757810VgnVCM100000700a10acRCRD' +
  '&videoChannelId=d1d6f5dfc8517810VgnVCM100000700a10acRCRD' +
  '&vcmid=1e2258089b67f510VgnVCM2000002a0c10acRCRD';

const KANAL_13_VIDEO_URL =
  'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8' +
  '?bitrate=5500000&videoId=0&renditions&fmp4&dvr=28800000';

const KANAL_13_AUDIO_URL =
  'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8' +
  '?bitrate=128000&audioId=1&lang=pol&renditions&fmp4&dvr=28800000';

const SUPPLEMENTAL_CHANNELS = [
  {
    name: 'Sky News',
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/7/74/Sky_News_logo.svg/512px-Sky_News_logo.svg.png',
    url: 'https://linear417-gb-hls1-prd-ak.cdn.skycdp.com/100e/Content/HLS_001_1080_30/Live/channel(skynews)/index_1080-30.m3u8',
    groupTitle: 'Live News',
  },
];

const MULTIVIEW_DEFAULTS = [
  '11-kanal-il',
  '12-kanal-il',
  '13-kanal-il',
  '14-kanal-il',
];

function isExcludedChannel(channelName) {
  const lowerName = channelName.toLowerCase();
  const normalizedName = lowerName.replace(/[\s\-_]/g, '');
  if (normalizedName === 'wep' || normalizedName === 'we2') return true;
  if (normalizedName.includes('bloomberg')) return true;
  if (normalizedName.includes('foxlive')) return true;
  if (normalizedName.includes('reuterstvus') || normalizedName === 'reuterstvus') return true;
  if (lowerName.includes('rick') && lowerName.includes('morty')) return true;
  return false;
}

function escapeYaml(str) {
  if (!str) return '""';
  if (/[:#{}[\],&*?|>!%@`"']/.test(str) || str.startsWith(' ') || str.endsWith(' ')) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

async function main() {
  const res = await fetch(M3U_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.text();

  const lines = data.split(/\r?\n/);
  const channels = [];
  let current = {};

  for (const line of lines) {
    if (line.startsWith('#EXTINF:-1')) {
      if (current.name && current.logo && current.url) {
        channels.push(current);
        current = {};
      }
      const attrs = {};
      for (const [, k, v] of line.matchAll(/(tvg-id|tvg-logo|group-title)="([^"]+)"/g)) {
        attrs[k] = v;
      }
      if (attrs['tvg-id'] && attrs['tvg-logo']) {
        current.name = attrs['tvg-id'];
        current.logo = attrs['tvg-logo'];
        current.groupTitle = attrs['group-title'] || 'Other';
      }
    } else if (line.trim() !== '' && !line.startsWith('#')) {
      current.url = line.trim();
    }
  }
  if (current.name && current.logo && current.url) {
    channels.push(current);
  }

  const filtered = channels.filter(ch => !isExcludedChannel(ch.name));
  const existingNames = new Set(filtered.map(ch => ch.name));
  for (const ch of SUPPLEMENTAL_CHANNELS) {
    if (!existingNames.has(ch.name)) filtered.push(ch);
  }

  // Build YAML output
  const out = [];
  out.push('settings:');
  out.push('  multiview_defaults:');
  for (const name of MULTIVIEW_DEFAULTS) {
    out.push(`    - ${escapeYaml(name)}`);
  }
  out.push('');
  out.push(`  mako_iframe_url: ${escapeYaml(MAKO_IFRAME_URL)}`);
  out.push('');
  out.push('channels:');

  for (const ch of filtered) {
    const isMako = ch.url.includes('php?m3u8');
    const isSplit = ch.name === '13-kanal-il';

    out.push(`  - name: ${escapeYaml(ch.name)}`);
    out.push(`    logo: ${escapeYaml(ch.logo)}`);
    out.push(`    category: ${escapeYaml(ch.groupTitle)}`);

    if (isMako) {
      out.push('    playback: mako');
    } else if (isSplit) {
      out.push('    playback: split');
      out.push(`    video_url: ${escapeYaml(KANAL_13_VIDEO_URL)}`);
      out.push(`    audio_url: ${escapeYaml(KANAL_13_AUDIO_URL)}`);
    }

    out.push(`    url: ${escapeYaml(ch.url)}`);
    out.push('');
  }

  process.stdout.write(out.join('\n') + '\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
