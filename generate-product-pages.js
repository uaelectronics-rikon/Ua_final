const fs = require('fs');
const path = require('path');

// All products data
const allProducts = [
  {id:1,  name:'INFRARED Induction Cooktop Prestige Gold Series G-22X',  brand:'UA RIKON',category:'Induction',   icon:'🍳',image:'Image/ind1.png',price:2499, mrp:3499, rating:4.8,reviews:1842,spec:'2000W · Touch Control · 6 Cooking Modes · Auto Shut-Off',description:'High-performance induction cooktop with touch control. Heats 40% faster than traditional stoves. Perfect for Indian cooking with multi-cook modes.',badge:'bestseller'},
  {id:2,  name:'UA RIKON Pro Induction Cooktop Gold',  brand:'UA RIKON',category:'Induction',   icon:'🍳',image:'Image/ind2.png',price:3199, mrp:4299, rating:4.7,reviews:976, spec:'2200W · Gold Edition · 8 Modes · Crystal Glass Panel',description:'Premium gold edition induction cooktop with crystal glass top. Enhanced design with 8 different cooking modes for versatile cooking.',badge:'new'},
  {id:3,  name:'UA RIKON Desert Air Cooler 50L',      brand:'UA RIKON',category:'Cooler',   icon:'❄️',image:'Image/cool4.png',price:5999, mrp:7999, rating:4.5,reviews:876, spec:'30L · Tower Fan · 4-Way Air Flow · Auto Fill',description:'Elegant tower cooler design. 4-way air flow distribution with automatic water filling system for continuous cooling.',badge:''},
  {id:4,  name:'UA RIKON Desert Air Cooler 50L',       brand:'UA RIKON',category:'Cooler',      icon:'❄️',image:'Image/cool1.png',price:7499, mrp:9999, rating:4.6,reviews:1234,spec:'50L Tank · 3 Speed · Honeycomb Pad · Remote Included',description:'Powerful desert cooler with 50L capacity. Cools large spaces efficiently with honeycomb cooling pads and remote control.',badge:'hot'},
  {id:5,  name:'UA RIKON Tower Air Cooler 30L',        brand:'UA RIKON',category:'Cooler',      icon:'❄️',image:'Image/cool2.png',price:5999, mrp:7999, rating:4.5,reviews:876, spec:'30L · Tower Fan · 4-Way Air Flow · Auto Fill',description:'Elegant tower cooler design. 4-way air flow distribution with automatic water filling system for continuous cooling.',badge:''},
  {id:6,  name:'UA RIKON Personal Room Cooler 20L',    brand:'UA RIKON',category:'Cooler',      icon:'❄️',image:'Image/cool3.png',price:3999, mrp:5499, rating:4.4,reviews:432, spec:'20L · Portable · 3 Speeds · Humidity Control',description:'Portable personal room cooler. Perfect for bedrooms with humidity control and 3 variable speed settings.',badge:'sale'},
  {id:7,  name:'UA RIKON 43" Full HD LED Smart TV',    brand:'UA RIKON',category:'LED TV',      icon:'📺',image:'Image/led1.png',price:18999,mrp:24999,rating:4.5,reviews:2341,spec:'43" · 1920×1080 · Android 11 · WiFi + HDMI × 3',description:'Crystal clear Full HD display with Android 11. Built-in WiFi for streaming movies and shows directly from popular apps.',badge:'bestseller'},
  {id:8,  name:'UA RIKON 32" HD LED Smart TV',         brand:'UA RIKON',category:'LED TV',      icon:'📺',image:'Image/led2.png',price:10999,mrp:14999,rating:4.3,reviews:1567,spec:'32" · HD Ready · Built-in WiFi · 2×HDMI · USB',description:'Compact 32-inch HD Ready display perfect for any room. Fast WiFi connectivity for seamless streaming experience.',badge:''},
  {id:9,  name:'UA RIKON 55" 4K Smart LED TV',         brand:'UA RIKON',category:'LED TV',      icon:'📺',image:'Image/led3.png',price:32999,mrp:44999,rating:4.7,reviews:654, spec:'55" · 4K UHD · Dolby Vision · Android Smart · BT',description:'Stunning 4K UHD picture quality with Dolby Vision support. Immersive viewing experience with Android Smart TV functionality.',badge:'new'},
  {id:10, name:'UA RIKON Premium Ceiling Fan 48"',     brand:'UA RIKON',category:'Fan',         icon:'🌀',image:'Image/fan1.png',price:2299, mrp:2999, rating:4.6,reviews:3241,spec:'48" · 380RPM · 5 Blades · High Speed · 70W',description:'Premium 48-inch ceiling fan with high speed motor. Durable construction with optimized blade design for maximum air circulation.',badge:'bestseller'},
  {id:11, name:'UA RIKON Table Fan 400mm',             brand:'UA RIKON',category:'Fan',         icon:'🌀',image:'Image/fan2.png',price:1299, mrp:1799, rating:4.4,reviews:987, spec:'400mm · 3 Speed · Metal Body · Oscillation',description:'Compact 400mm table fan with metal construction. 3-speed settings with oscillation for better air distribution across the room.',badge:''},
  {id:12, name:'UA RIKON Tower Fan with Remote',       brand:'UA RIKON',category:'Fan',         icon:'🌀',image:'Image/fan3.png',price:4299, mrp:5999, rating:4.5,reviews:432, spec:'45" Tower · 12 Speed · Timer · Remote · Silent',description:'Sleek tower fan with remote control. 12 speed levels and inbuilt timer for easy operation and energy efficiency.',badge:'new'},
  {id:13, name:'UA RIKON 5.1 Home Theatre 100W',       brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic1.png',price:7999, mrp:10999,rating:4.7,reviews:1123,spec:'100W · 5.1 Channel · Dolby · BT · FM · USB · Remote',description:'Immersive 5.1 channel home theatre with 100W output. Dolby enhanced sound with Bluetooth connectivity for wireless audio streaming.',badge:'hot'},
  {id:14, name:'UA RIKON 2.1 Music System 60W',        brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic2.png',price:3999, mrp:5499, rating:4.5,reviews:876, spec:'60W · 2.1 Channel · BT 5.0 · FM · AUX · LED Display',description:'Powerful 2.1 music system perfect for music lovers. Bluetooth 5.0 with FM tuner and AUX input for versatile connectivity.',badge:''},
  {id:15, name:'UA RIKON Soundbar 80W 2.1',            brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic3.png',price:5499, mrp:7999, rating:4.6,reviews:543, spec:'80W · 2.1 Soundbar · HDMI ARC · BT · Optical · Bass Boost',description:'Premium soundbar with 80W dual channel output. HDMI ARC, Bluetooth, and optical connectivity for all your entertainment needs.',badge:'new'},
  {id:16, name:'UA RIKON Portable BT Speaker Pro',     brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic4.png',price:2999, mrp:4499, rating:4.5,reviews:654, spec:'20W · Portable · 360° Sound · 12h Battery · IPX5',description:'Compact portable Bluetooth speaker with 360-degree sound coverage. 12-hour battery life and IPX5 waterproof rating perfect for outdoor use.',badge:''},
  {id:17, name:'UA RIKON Mini Tower Speaker',         brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic5.png',price:4299, mrp:5999, rating:4.4,reviews:432, spec:'50W · 2.0 Channel · BT 5.0 · FM · USB',description:'Compact tower speaker with powerful bass and crystal clear treble. Perfect for small rooms with Bluetooth and FM connectivity.',badge:''},
  {id:18, name:'UA RIKON Bass Booster Subwoofer',      brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic6.png',price:3499, mrp:4999, rating:4.6,reviews:321, spec:'40W · Deep Bass · 8" Subwoofer · RCA Connection',description:'Dedicated subwoofer delivering deep bass for enhanced audio experience. Compatible with most home theatre and sound systems.',badge:'sale'},
  {id:19, name:'UA RIKON 4K Projector Bundle',          brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic7.png',price:18999, mrp:24999, rating:4.7,reviews:187, spec:'4K UHD · 3000 Lumens · WiFi · HDMI × 2',description:'Premium 4K projector for your home entertainment. Perfect for movies and gaming with 3000 lumens brightness and WiFi connectivity.',badge:'hot'},
  {id:20, name:'UA RIKON Karaoke Mixer System',         brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic8.png',price:6999, mrp:8999, rating:4.5,reviews:267, spec:'120W · Karaoke · Bluetooth · USB · Reverb',description:'Complete karaoke system with dual microphones and mixer. Perfect for parties with echo, reverb, and balance controls.',badge:''},
  {id:21, name:'UA RIKON Studio Monitor Speakers',      brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic9.png',price:8999, mrp:11999, rating:4.6,reviews:198, spec:'40W × 2 · Studio Grade · RCA × 2 · 3.5mm',description:'Professional studio monitor speakers for accurate audio reproduction. Ideal for music production and monitoring.',badge:'new'},
  {id:22, name:'UA RIKON Surround Speaker Pair',        brand:'UA RIKON',category:'Home Theatre',icon:'🔊',image:'Image/mic0.png',price:4499, mrp:5999, rating:4.4,reviews:276, spec:'30W × 2 · Wireless · 5.1 Compatible · Wall Mount',description:'Wireless surround speakers to enhance your home theatre setup. Easy wall mounting for perfect sound immersion.',badge:''},
];

// Read the template from product-1.html
const templatePath = path.join(__dirname, 'product-1.html');
const template = fs.readFileSync(templatePath, 'utf-8');

// Generate product pages for all products (2-22)
// We'll copy product-1.html for each product since they're all generic now
console.log('Generating product pages...');

for (let i = 1; i <= 22; i++) {
  const filename = `product-${i}.html`;
  const filepath = path.join(__dirname, filename);
  
  // Write the template as-is (it's already generic)
  fs.writeFileSync(filepath, template);
  console.log(`✓ Created ${filename}`);
}

console.log('\n✅ All 22 product pages generated successfully!');
console.log('Each page works with ?id= or defaults to product 1');
