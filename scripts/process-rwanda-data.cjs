// Process Rwanda administrative data from @devrw/rwanda-location package
// and organize it hierarchically by district for code splitting

const fs = require('fs');
const path = require('path');

// Load the raw data
const rawData = require('@devrw/rwanda-location/dist/db/locations.json');

console.log('Processing Rwanda administrative data...');
console.log('Total raw records:', rawData.length);

// Build hierarchical structure
const hierarchy = {};

rawData.forEach(record => {
  const {
    province_name,
    district_name,
    sector_name,
    cell_name,
    village_name
  } = record;

  // Initialize province if needed
  if (!hierarchy[province_name]) {
    hierarchy[province_name] = {};
  }

  // Initialize district if needed
  if (!hierarchy[province_name][district_name]) {
    hierarchy[province_name][district_name] = {};
  }

  // Initialize sector if needed
  if (!hierarchy[province_name][district_name][sector_name]) {
    hierarchy[province_name][district_name][sector_name] = {};
  }

  // Initialize cell if needed
  if (!hierarchy[province_name][district_name][sector_name][cell_name]) {
    hierarchy[province_name][district_name][sector_name][cell_name] = [];
  }

  // Add village if not already present
  if (!hierarchy[province_name][district_name][sector_name][cell_name].includes(village_name)) {
    hierarchy[province_name][district_name][sector_name][cell_name].push(village_name);
  }
});

// Count totals
const provinces = Object.keys(hierarchy);
let totalDistricts = 0;
let totalSectors = 0;
let totalCells = 0;
let totalVillages = 0;

provinces.forEach(province => {
  const districts = Object.keys(hierarchy[province]);
  totalDistricts += districts.length;

  districts.forEach(district => {
    const sectors = Object.keys(hierarchy[province][district]);
    totalSectors += sectors.length;

    sectors.forEach(sector => {
      const cells = Object.keys(hierarchy[province][district][sector]);
      totalCells += cells.length;

      cells.forEach(cell => {
        const villages = hierarchy[province][district][sector][cell];
        totalVillages += villages.length;
      });
    });
  });
});

console.log('\nHierarchy Statistics:');
console.log('Provinces:', provinces.length);
console.log('Districts:', totalDistricts);
console.log('Sectors:', totalSectors);
console.log('Cells:', totalCells);
console.log('Villages:', totalVillages);

// Create output directory
const outputDir = path.join(__dirname, '..', 'src', 'data', 'rwanda');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Create province-district mapping
const provinceDistrictMap = {};
provinces.forEach(province => {
  provinceDistrictMap[province] = Object.keys(hierarchy[province]).sort();
});

fs.writeFileSync(
  path.join(outputDir, 'provinces.json'),
  JSON.stringify({ provinces: provinces.sort(), districts: provinceDistrictMap }, null, 2)
);

console.log('\nWriting district files...');

// Write one file per district
provinces.forEach(province => {
  const districts = Object.keys(hierarchy[province]);

  districts.forEach(district => {
    const districtData = {
      province: province,
      district: district,
      sectors: {}
    };

    const sectors = Object.keys(hierarchy[province][district]).sort();
    sectors.forEach(sector => {
      const cells = Object.keys(hierarchy[province][district][sector]).sort();
      districtData.sectors[sector] = {};

      cells.forEach(cell => {
        const villages = hierarchy[province][district][sector][cell].sort();
        districtData.sectors[sector][cell] = villages;
      });
    });

    // Create safe filename (replace special characters)
    const safeDistrictName = district.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `${safeDistrictName}.json`;

    fs.writeFileSync(
      path.join(outputDir, filename),
      JSON.stringify(districtData, null, 2)
    );
  });
});

console.log(`\nSuccessfully created ${totalDistricts} district files in ${outputDir}`);
console.log('\nVerification:');
console.log('Expected: 5 provinces, 30 districts, 416 sectors, 2,148 cells, 14,837 villages');
console.log(`Actual:   ${provinces.length} provinces, ${totalDistricts} districts, ${totalSectors} sectors, ${totalCells} cells, ${totalVillages} villages`);

// Create index file with all district filenames
const districtIndex = {};
provinces.forEach(province => {
  districtIndex[province] = {};
  Object.keys(hierarchy[province]).forEach(district => {
    const safeDistrictName = district.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    districtIndex[province][district] = `${safeDistrictName}.json`;
  });
});

fs.writeFileSync(
  path.join(outputDir, 'index.json'),
  JSON.stringify(districtIndex, null, 2)
);

console.log('\nDone! Created:');
console.log('- provinces.json (province and district lists)');
console.log('- index.json (mapping of provinces/districts to files)');
console.log(`- ${totalDistricts} district JSON files (with sectors, cells, villages)`);
