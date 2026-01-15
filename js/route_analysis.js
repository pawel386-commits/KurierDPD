
window.runRouteAnalysis = async function(silent = false) {
    const statusEl = document.getElementById('routeAnalysisStatus');
    const container = document.getElementById('masterRouteContainer');
    
    if(!silent && statusEl) statusEl.classList.remove('hidden');
    
    // Allow UI to update
    await new Promise(r => setTimeout(r, 100));

    try {
        const logs = JSON.parse(localStorage.getItem('dpd_logs_v13') || '[]');
        if (logs.length === 0) {
            if(!silent) throw new Error("Brak historii do analizy.");
            return;
        }

        // 1. Group by Date
        const byDate = {};
        logs.forEach(log => {
            if (!log.date) return;
            if (!byDate[log.date]) byDate[log.date] = [];
            byDate[log.date].push(log);
        });

        const addressStats = {}; // Map<NormalizedAddress, { sumPos: 0, count: 0, lat: 0, lng: 0, street: "" }>

        // 2. Process each day
        Object.entries(byDate).forEach(([date, dayLogs]) => {
            // Sort by ID (assuming ID is timestamp) or Time
            dayLogs.sort((a, b) => a.id - b.id);

            // Filter out days with too few stops
            if (dayLogs.length < 5) return;

            const totalStops = dayLogs.length;
            dayLogs.forEach((log, index) => {
                const relPos = index / (totalStops - 1); // 0.0 to 1.0
                const addr = log.address; 
                
                if (!addressStats[addr]) {
                    addressStats[addr] = { 
                        sumPos: 0, 
                        count: 0, 
                        latSum: 0, 
                        lngSum: 0, 
                        latCount: 0,
                        street: window.normalizeStreetName(addr)
                    };
                }
                
                addressStats[addr].sumPos += relPos;
                addressStats[addr].count++;
                
                if (log.lat && log.lng) {
                    addressStats[addr].latSum += parseFloat(log.lat);
                    addressStats[addr].lngSum += parseFloat(log.lng);
                    addressStats[addr].latCount++;
                }
            });
        });

        // 3. Compute Averages & Create Nodes
        const nodes = Object.entries(addressStats).map(([addr, stats]) => {
            return {
                address: addr,
                street: stats.street,
                avgPos: stats.count > 0 ? stats.sumPos / stats.count : 0.5,
                count: stats.count,
                lat: stats.latCount > 0 ? stats.latSum / stats.latCount : null,
                lng: stats.latCount > 0 ? stats.lngSum / stats.latCount : null
            };
        }).filter(n => n.count >= 1); // Take all visited addresses (or >= 2 for stability)

        if (nodes.length === 0) {
             throw new Error("Zbyt mało danych do analizy.");
        }

        // 4. Sort by Average Position (Global Sequence)
        nodes.sort((a, b) => a.avgPos - b.avgPos);

        // 5. Segment Detection (Herringbone)
        const masterRoute = [];
        let currentSegment = null;

        nodes.forEach(node => {
            if (!currentSegment) {
                currentSegment = {
                    street: node.street,
                    nodes: [node],
                    avgPos: node.avgPos
                };
            } else {
                if (node.street === currentSegment.street) {
                    currentSegment.nodes.push(node);
                    // Update avgPos ?? 
                    // Keeping avgPos as start is fine for sorting, but maybe average of segment nodes?
                } else {
                    masterRoute.push(currentSegment);
                    currentSegment = {
                        street: node.street,
                        nodes: [node],
                        avgPos: node.avgPos
                    };
                }
            }
        });
        if (currentSegment) masterRoute.push(currentSegment);

        // 6. Post-processing Segments
        // Filter out very small segments if they are just noise between same streets?
        // E.g. Street A -> Street B (1 node) -> Street A.
        // For now keep raw data as it reflects history.

        // Refine Segment Data
        masterRoute.forEach(seg => {
            const nums = seg.nodes.map(n => {
                const match = n.address.match(/(\d+)/);
                return match ? parseInt(match[1]) : null;
            }).filter(n => n !== null);
            
            let direction = "Mieszany";
            let range = "Brak numerów";

            if (nums.length > 0) {
                 range = `${Math.min(...nums)}-${Math.max(...nums)}`;
                 if (nums.length > 1) {
                     // Determine trend
                     // Simple check: first vs last of the segment
                     // But nodes are sorted by their individual avgPos. 
                     // So if nodes are sorted by avgPos, and we check their numbers:
                     // If nums are increasing in the nodes list, it means later relative position correlates with higher number -> Ascending.
                     
                     // We need to check the correlation of index vs number.
                     let increasingCount = 0;
                     let decreasingCount = 0;
                     for (let i = 0; i < nums.length - 1; i++) {
                         if (nums[i+1] > nums[i]) increasingCount++;
                         if (nums[i+1] < nums[i]) decreasingCount++;
                     }
                     
                     if (increasingCount > decreasingCount) direction = "Rosnąco";
                     else if (decreasingCount > increasingCount) direction = "Malejąco";
                 }
            }
            seg.direction = direction;
            seg.range = range;
        });
        
        localStorage.setItem('idealRouteSchema', JSON.stringify(masterRoute));
        if(!silent) {
            window.renderMasterRoute(masterRoute);
            window.showToast("Analiza zakończona", "check", "text-green-500");
        }

    } catch (e) {
        console.error(e);
        if(!silent) window.showToast("Błąd: " + e.message, "alert-circle", "text-red-500");
    } finally {
        if(!silent && statusEl) statusEl.classList.add('hidden');
    }
};

// Auto-run on load
window.addEventListener('load', () => {
    // Delay slightly to let app initialize
    setTimeout(() => {
        window.runRouteAnalysis(true);
    }, 2000);
});

window.renderMasterRoute = function(routeData) {
    const container = document.getElementById('masterRouteContainer');
    if (!container) return;
    
    if (!routeData) {
        try {
            routeData = JSON.parse(localStorage.getItem('idealRouteSchema'));
        } catch(e) {}
    }
    
    if (!routeData || routeData.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 opacity-50">
                <i data-lucide="map" class="w-12 h-12 mx-auto mb-2 opacity-50"></i>
                <p class="text-xs font-bold">Brak wygenerowanej trasy.</p>
                <p class="text-[10px]">Kliknij przycisk powyżej, aby przeanalizować historię.</p>
            </div>`;
        return;
    }
    
    container.innerHTML = routeData.map((seg, idx) => {
        return `
            <div class="bg-white dark:bg-zinc-900/50 p-3 rounded-xl border border-gray-100 dark:border-zinc-800 flex gap-3 relative overflow-hidden">
                <div class="flex-none flex flex-col items-center gap-1 pt-1">
                    <div class="w-6 h-6 rounded-full bg-dpd-red text-white flex items-center justify-center text-[10px] font-black shadow-sm z-10">
                        ${idx + 1}
                    </div>
                    ${idx < routeData.length - 1 ? '<div class="w-0.5 flex-1 bg-gray-100 dark:bg-zinc-800 -mb-4"></div>' : ''}
                </div>
                <div class="flex-1 min-w-0 pb-2">
                    <h3 class="font-black text-sm text-gray-800 dark:text-gray-200 truncate">${seg.street}</h3>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400">
                            ${seg.range}
                        </span>
                        <span class="text-[10px] font-bold bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded text-blue-600 dark:text-blue-300">
                            ${seg.direction}
                        </span>
                    </div>
                    <p class="text-[10px] opacity-40 mt-1">Śr. postęp: ${(seg.avgPos * 100).toFixed(0)}% • Adresów: ${seg.nodes.length}</p>
                </div>
            </div>
        `;
    }).join('');
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
};
