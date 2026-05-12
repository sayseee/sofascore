require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pipeline = require('../services/dataPipelineService');

async function run(date) {
    console.log(`\n🚀 FULL PIPELINE FOR: ${date}\n`);
    
    pipeline.on('progress', (data) => {
        console.log(`   [${data.currentStep}/${data.totalSteps}] ${data.step} (${data.progress}%)`);
    });
    
    pipeline.on('complete', (data) => {
        console.log(`\n✅ PIPELINE COMPLETE: ${data.date}\n`);
    });

    await pipeline.collectAllForDate(date);
}

const date = process.argv[2] || new Date().toISOString().split('T')[0];
console.log(`📅 Date: ${date}`);
run(date).catch(console.error);