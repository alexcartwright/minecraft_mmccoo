
// for this to work:
// you need the following run results from basic_test (basically, you juse run basic_test in this dir):
// biomeproperties.js
// world.js
// dist/biomes.json
// dist/block_entities.json
// dist/entities.json
// dist/villages.json

// in this directory, do
// npm install
// npm start
//
// if you want to host on apache2, do
// npm run build

import 'ol/ol.css';
import {Map, View, proj} from 'ol';
import TileLayer from 'ol/layer/Tile';
import {createXYZ} from 'ol/tilegrid'
import Projection from 'ol/proj/Projection';
import OSM from 'ol/source/OSM';
import SourceXYZ from 'ol/source/XYZ';
import FillStyle from 'ol/style/Fill';
import StrokeStyle from 'ol/style/Stroke';
import CircleStyle from 'ol/style/Circle';
import Icon from 'ol/style/Icon';
import * as olExtent from 'ol/extent';
import MousePosition from 'ol/control/MousePosition';
import OverViewControl from 'ol/control/OverviewMap';
import VectorImage from 'ol/layer/VectorImage';
import Vector from 'ol/layer/Vector';
import SourceVector from 'ol/source/Vector';
import FormatGeoJSON from 'ol/format/GeoJSON';
import MyGeoJSON from './MyGeoJSON';
import Style from 'ol/style/Style';
import TextStyle from 'ol/style/Text';
import { createOrUpdateFromFlatCoordinates } from 'ol/extent';
import Collection from 'ol/Collection';

import Stroke from 'ol/style/Stroke';
import Polygon from 'ol/geom/Polygon.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString';
import Overlay from 'ol/Overlay';

// the mod icons came from here:
// http://i.imgur.com/wR0Lw7o.png
// https://www.minecraftforum.net/forums/mapping-and-modding-java-edition/resource-packs/1245006-free-minecraft-icon-pack-by-wskoie1
//
// which I split using the scripting in this post:
// https://graphicdesign.stackexchange.com/a/12750

// it's important that the sprites directory is not called icons:
// https://electrictoolbox.com/apache-icons-directory/

// from https://github.com/depressed-pho/slime-finder-pe/blob/master/lib/chunk.ts
// The function below is basically the function from slime-finder-pe verbatim. Just
// converted from a class method to a dumb function
var MersenneTwister = require('mersenne-twister');

// this function is lifted from https://github.com/depressed-pho/slime-finder-pe/blob/master/lib/umul32.ts
function umul32_lo(a, b) {
  let a00 = a & 0xFFFF;
  let a16 = a >>> 16;
  let b00 = b & 0xFFFF;
  let b16 = b >>> 16;

  let c00 = a00 * b00;
  let c16 = c00 >>> 16;

  c16 += a16 * b00;
  c16 &= 0xFFFF;
  c16 += a00 * b16;

  let lo = c00 & 0xFFFF;
  let hi = c16 & 0xFFFF;

  return ((hi << 16) | lo) >>> 0;
}

function isSlimy(x,z) {
  /*! MCPE slime-chunk checker; reverse engineered by @protolambda and @jocopa3
   * Ported by PHO from Java code:
   *   https://gist.github.com/protolambda/00b85bf34a75fd8176342b1ad28bfccc
   * Simplified by hhhxiao:
   *   https://github.com/depressed-pho/slime-finder-pe/issues/2
   */
  let x_uint    = (x / 16) >>> 0;
  let z_uint    = (z / 16) >>> 0;
  let seed      = umul32_lo(x_uint, 0x1f1f1f1f) ^ z_uint;
  let mt        = new MersenneTwister(seed);
  let n         = mt.random_int();
  return (n % 10 == 0);
}


var world_info = {}; //require('./world.js');
var biome_styles = {};

var getJSON = function(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'json';
    xhr.onload = function() {
      var status = xhr.status;
      if (status === 200) {
        callback(null, xhr.response);
      } else {
        callback(status, xhr.response);
      }
    };
    xhr.send();
};
getJSON("./map/world.json", function(err, data) {
    console.log(data);
    world_info = data;
    build_layers_and_map();
}
       )

getJSON("./map/biomeproperties.json", function(err, biomeproperties) {
    console.log(biomeproperties);
    for (var b in biomeproperties.biome_colors) {
        biome_styles[b] = new Style({
            fill: new FillStyle({
                color: biomeproperties.biome_colors[b],
            }),
            stroke: new StrokeStyle({
                color: [0,0,0,1],
                width: 1
            }),
        })
    }
}
       )


// colors based on this: https://de.mathworks.com/help/map/ref/demcmap.html
var elevation_colors = {
    0: [0,0,0, 0.5], // bedrock/void black
    10: [207, 74, 10, 0.5], // lava
    20: [100, 240, 222, 0.5], // top of diamond level.
    30: [89, 100, 0, 0.5],
    40: [93, 0, 100, 0.5],
    50: [0, 0,   255, 0.5], // deep blue
    60: [0, 127, 255, 0.5], // lite blue
    70: [0, 102, 51, 0.5],  // lite green
    80: [0, 100, 0, 0.5],
    90: [0, 200, 0, 0.5],
    100: [0, 200, 0, 0.5],
    110: [90, 160, 219, 0.5],

    //12: [100, 240, 222], // diamond level.
    //53: [8,21,180], // water
    //65: [50, 78, 43], // grass
    //75: [79, 57, 40], // dirt.
    //128: [90, 160, 219],
};

var color_fills = {};
var cur_color = new FillStyle({ color: elevation_colors[0] });

for(let i=0; i<256; i++) {
    if (i in elevation_colors) {
        cur_color = new FillStyle({ color: elevation_colors[i] });
    }

    color_fills[i] = cur_color;
}

// yes, this is an awful function. It needs to be cleanedup/refactored/so many things.
// It's a function because I need the world_info data.
function build_layers_and_map()
{
    const pixels_per_block = 4;
    // this is the boundary of the zero level tile.
    var mapxl = world_info.chunk_xl*16;
    var mapyl = world_info.chunk_zl*16;
    var mapxh = world_info.chunk_xl*16 + world_info.tile_0_size;
    var mapyh = world_info.chunk_zl*16 + world_info.tile_0_size;

    // this extent is in units of minecraft blocks
    var mapextent = [mapxl, mapyl, mapxh, mapyh];

    var flatProjection = new Projection({
        code: 'ZOOMIFY',
        units: 'pixels',
        // where is this projection valid.
        extent: [-1024*1024, -1024*1024, 1024*1024, 1024*1024],
    })

    var tilegrid = new createXYZ({
        // Extent for the tile grid. The origin for an XYZ tile grid is the top-left
        // corner of the extent. The zero level of the grid is defined by the resolution
        // at which one tile fits in the provided extent. If not provided, the extent of
        // the EPSG:3857 projection is used.
        extent: mapextent,
        //maxZoom: 10,
        tileSize: [64,64],
    });
    var res = tilegrid.getResolutions();

    var maplayer = new TileLayer({
        opacity: .5,
        // use interim is important. it prevents repeatedly
        // trying to load non-existent tiles.
        useInterimTilesOnError: false,
        source: new SourceXYZ({
            // default resolution with zoom 1 in view is 3.
            url: 'http://localhost/flatmap/tiling/{z}/biome_{x}_{y}.png',
            projection: flatProjection,
            tileGrid: tilegrid,
            //tileUrlFunction: function(coordinate) {
            //    console.log(coordinate);
            //    return 'tiles/chunk/biome_' + (coordinate[1]-20) + '_' + (coordinate[2]-20) + '.png';
            //},
        }),
    });

    const fillStyle = new FillStyle({
        color: [84,118,255,.5]
    })

    const strokeStyle = new StrokeStyle({
        color: [46,45,45,1],
        width: 1,
    })

    const circleStyle = new CircleStyle({
        fill: new FillStyle({
            color: [245,49,5,1]
        }),
        radius: 7,
        stroke: strokeStyle,
    })

    const iconStyle = new  Style({
        image: new Icon({
            src: 'sprites/creeper.png'
        })
    })
    const defaultStyle = new Style({
        fill: fillStyle,
        stroke: strokeStyle,
        //image: circleStyle,
        image: new Icon({
            src: 'sprites/creeper.png'
        })
    })

    var invisibleStyle = new Style({
        image: new CircleStyle({
            fill: new FillStyle({
                color: [245,49,5,0]
            }),
            radius: 7,
            stroke: new StrokeStyle({
                color: [46,45,45,0],
                width: 1
            })
        }),
        stroke: new StrokeStyle({
            color: [46,45,45,0],
            width: 1
        }),
    });

    const testJSONlayer = new VectorImage({
        source: new SourceVector({
            url: './test.json',
            //format: new FormatGeoJSON(),
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: new Style({
            fill: fillStyle,
            stroke: strokeStyle,
            image: circleStyle,
        })
    });

    var biomeStyleFunction = function(feature) {
        var biome = feature.get('biome');
        if (!(biome in biome_styles)) {
            console.log("don't have color for " + biome);
            return defaultStyle;
        }
        return biome_styles[biome];
    };

    const biomesJSONlayer = new VectorImage({
        source: new SourceVector({
            url: './map/biomes.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: biomeStyleFunction,

    });

    var colors = []
    const cspace = 60
    for(let i=0; i<cspace; i++){
        colors.push([256*(cspace-i)/cspace, 256*i/cspace, 0]);
    }
    for(let i=0; i<40; i++){
        colors.push([0, 256*(40-i)/40, 256*i/40]);
    }
    var elevationStyleFunction = function(feature) {
        var elevation = feature.get('elevation') * world_info.y_resolution;

        if (elevation >= cspace*2) { elevation = cspace*2 }

        return new Style({
            //fill: new FillStyle({ color: [elevation,elevation,elevation,0] }),
            fill: color_fills[elevation], //new FillStyle({ color: colors[elevation] }),
            stroke: strokeStyle,
            image: circleStyle,
        });
    };

    const elevationsJSONlayer = new VectorImage({
        source: new SourceVector({
            url: './map/elevations.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: elevationStyleFunction,
    });


    var caveStyleFunction = function(feature) {
        var elevation = feature.get('elevation')*world_info.y_resolution;

        return new Style({
            fill: color_fills[elevation],
            stroke: strokeStyle,
            image: circleStyle,
        });
    }

    const cavesJSONlayer = new VectorImage({
        source: new SourceVector({
            url: './map/caves.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: caveStyleFunction,
    });

    var mobstyles = {};

    for (let icon of [
        "blaze",
        "cow",
        "creeper",
        "dolphin",
        "enderman",
        "ghast",
        "golem",
        "pig",
        "sheep",
        "skeleton",
        "slime",
        "villager_v2",
        "zombie_villager_v2",
        "whither",
        "zombie",
        "spider",
        "cat",
        "horse",
        "chicken",
        "llama",
        "cave_spider",
        "drowned",
        "bat",
        "rabbit",
        "squid",
        "xp_orb",
        "parrot",
        "bee",
        "panda",
        "ocelot",
        "witch",
        "pillager",
        "wolf",
        "item",
        "wandering_trader",
    ]) {
        mobstyles[icon] = new Style({
            fill: fillStyle,
            stroke: strokeStyle,
            image: new Icon({
                src: 'sprites/' + icon + '.png',
                scale: 0.2,
            }),
        })

    };

    var passives = [
        "cow",
        "golem",
        "pig",
        "sheep",
        "cat",
        "horse",
        "chicken",
        "llama",
        "bat",
        "rabbit",
        "squid",
        "dolphin",
        "xp_orb",
        "parrot",
        "bee",
        "panda",
        "ocelot",
        "wolf",
        "item",
        "wandering_trader",
    ]

    mobstyles['other'] = new Style({
        fill: fillStyle,
        stroke: strokeStyle,
        image: circleStyle,
    });


    var showPassives = true;
    var entityStyleFunction = function(feature) {
        var type = feature.get("type").substring(10);

        if (!showPassives && passives.includes(type)) {
            return invisibleStyle;
        }

        if (type in mobstyles) {
            return mobstyles[type];
        } else {
            return mobstyles['other'];
        }
    }

    const entitiesJSONLayer = new VectorImage({
        source: new SourceVector({
            url: './map/entities.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: entityStyleFunction,
    })

    var resourceStyles = {};
    for (let icon of [
        "diamond_ore",
        "torch",
        "emerald_ore", // not sure this is the right name.
        "lapis_ore",
        "bee_nest",
        "bell",
    ]) {
        resourceStyles[icon] = new Style({
            fill: fillStyle,
            stroke: strokeStyle,
            image: new Icon({
                src: 'sprites/' + icon + '.png',
                scale: 0.2,
            }),
        })

    };
    resourceStyles['other'] = new Style({
        fill: fillStyle,
        stroke: strokeStyle,
        image: circleStyle,
    });

    var showResources = true;
    var showSurfaceResources = true;
    var resourceStyleFunction = function(feature) {
        var type = feature.get("name").substring(10);
        var surface = feature.get("surface");

        if (!showResources) { return invisibleStyle; }
        if (!showSurfaceResources && surface) { return invisibleStyle; }

        if (type in resourceStyles) {
            return resourceStyles[type];
        } else {
            console.log("didn't find " + type);
            return resourceStyles['other'];
        }
    }

    const resourceJSONLayer = new VectorImage({
        source: new SourceVector({
            url: './map/resources.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: resourceStyleFunction,
    })



    var block_styles = {}
    for (let icon of [
        "Chest",
        "MobSpawner",
        "Bed",
        "Beehive",
        "Furnace",
        "Hopper",
    ]) {
        block_styles[icon] = new Style({
            fill: fillStyle,
            stroke: strokeStyle,
            image: new Icon({
                src: 'sprites/' + icon + '.png',
                scale: 0.2,
            }),
        })

    };
    block_styles['other'] = new Style({
        fill: fillStyle,
        stroke: strokeStyle,
        image: new CircleStyle({
            fill: new FillStyle({
                color: [0,249,0,1]
            }),
            radius: 7,
            stroke: strokeStyle,
        }),
    });

    var blockEntityStyleFunction = function(feature) {
        var type = feature.get("type");

        if (type in block_styles) {
            //console.log("known type is " + type);
            return block_styles[type];
        } else {
            console.log("unknown type is " + type);
            return block_styles['other'];
        }
    }

    const blockEntitiesJSONLayer = new VectorImage({
        source: new SourceVector({
            url: './map/block_entities.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "my vectors",
        style: blockEntityStyleFunction,
    })

    var villageStyleFunction = function(feature) {
        var retval = new Style({
            fill: new FillStyle({ color: [0,118,0,.1] }),
            stroke: strokeStyle,
            image:  circleStyle,
            text: new TextStyle({
                font: '20px sans-serif',
                fill: new FillStyle({ color: [0,0,0,1] }),
                stroke: new StrokeStyle({
                    color: [0,0,0,1], width: 1
                }),
                // overflow is important. without it, the text won't display
                overflow : true,
                text: 'village',
            })
        });

        return retval;

    }
    const villagesJSONLayer = new Vector({
        source : new SourceVector({
            url: './map/villages.json',
            format: new MyGeoJSON(mapyl, mapyh),
            projection: flatProjection,
        }),
        visible: true,
        title: "villages",
        style: villageStyleFunction,
    })

    var myview = new View({
        extent: mapextent,
        center: [160,130], // center,
        zoom: 1,
        //maxZoom: 10,
        projection: flatProjection,
        resolutions: tilegrid.getResolutions(),
    });

    var poly = new Polygon([
        // array of polygons
        [
            // array of points
            [92,-560], [169, -560], [169,-648], [92, -648], [92, -560]
        ]
    ]);

    var line = new LineString([
        [92,-560], [169,-648]
    ]);

    var chunkbounds = [];
    for(let x=mapxl; x<mapxh; x+=16) {
        chunkbounds.push(new Feature({
            geometry: new LineString([
                [x, mapyl], [x, mapyh]
            ])
        }));
    }
    for(let y=mapyl; y<mapyh; y+=16) {
        chunkbounds.push(new Feature({
            geometry: new LineString([
                [mapxl, y], [mapxh, y]
            ])
        }));
    }


    const ChunkBoundsLayer = new Vector({
        strokeStyle: new Stroke({
            color: 'rgba(255,120,0,0.9)',
            width: 2,
            lineDash: [0.5, 4]
        }),
        visible: true,
        source: new SourceVector({
            features: chunkbounds,
            //features: [
            //  new Feature({
            //    geometry: poly,
            //  }),
            //  new Feature({
            //    geometry: line,
            //  }),
            //]
        }),

        style: new Style({
            fill: fillStyle,
            stroke: new StrokeStyle({
                color: [46,45,45,.25],
                width: 1
            }),
            image: circleStyle,
        }),
    });

    var slimeChunks = [];
    // again, I'm using the y axis in the normal euclidean sense.
    // minecraft uses Z for that axis
    for(let x=mapxl/16; x<mapxh/16; x++) {
        for(let y=mapyl/16; y<mapyh/16; y++) {
            if (!isSlimy(x*16, y*16)) { continue; }

            let xl = x*16;
            let yl = mapyl + mapyh - y*16;
            slimeChunks.push(new Feature({
                geometry: new Polygon([[
                    [xl,    yl],
                    [xl+16, yl],
                    // the y is -16 because we're flipping the display of the y axis.
                    // this way these results match https://chunkbase.com/apps/slime-finder
                    [xl+16, yl-16],
                    [xl,    yl-16],
                    [xl,    yl],
                ]]),
            }));
        }
    }


    const SlimeChunkLayer = new Vector({
        strokeStyle: new Stroke({
            color: 'rgba(255,120,0,0.9)',
            width: 2,
            lineDash: [0.5, 4]
        }),
        visible: true,
        source: new SourceVector({
            features: slimeChunks,
        }),

        style: new Style({
            fill: new FillStyle({ color: [46,204,30,.2] }),
            stroke: new StrokeStyle({
                color: [46, 204, 30, .8],
                width: 1
            }),
            image: circleStyle,
        }),
    });


    const overviewMapControl = new OverViewControl({
        collapsed: false,
        layers: [new VectorImage({
            source: new SourceVector({
                url: './map/biomes.json',
                format: new MyGeoJSON(mapyl, mapyh),
                projection: flatProjection,
            }),
            visible: true,
            title: "my vectors",
            style: biomeStyleFunction,

        })],
    });



    var mousePositionControl = new MousePosition({
        target: 'mouse-overlay',
    });

    var coordinateFormatFunction = function(coordinate, template, opt_fractionDigits) {

        var map = mousePositionControl.getMap();
        var pixel = map.getPixelFromCoordinate(coordinate);
        var biome = "unknown biome"
        var entities = {};
        var blockentities = {};
        var elevations = [];
        var caves = [];

        var village_sections = []
        var spawners = [];
        var resources = [];
        map.forEachFeatureAtPixel(pixel, function(feature, layer){
            if (layer == biomesJSONlayer) {
                biome = feature.get('biome');
            }

            if (layer == entitiesJSONLayer) {
                entities[feature.get("type")] = ++entities[feature.get("type")] || 1;
            }

            if (layer == blockEntitiesJSONLayer) {
                if (feature.get("type") == "MobSpawner") {
                    let sp = feature.get("spawner_type").substring(10) + " spawner";
                    let s = sp + " y:" + feature.get('coords')[1]
                    spawners.push(s);
                } else {
                    blockentities[feature.get("type")] = ++blockentities[feature.get("type")] || 1;
                }
            }

            if (layer == villagesJSONLayer) {
                let bounds = feature.get("bounds");
                let village_section = "village y(" + bounds[1] + "," + bounds[4];
                village_section += ")<br>dwellers:"
                let counts = feature.get("counts");
                for (let d in counts) {
                    village_section += d.substr(10) + ":" + counts[d] + " ";
                }
                village_sections.push(village_section);
            }

            if (layer == elevationsJSONlayer) {
                elevations.push(feature.get("elevation")*world_info.y_resolution)
            }

            if (layer == cavesJSONlayer) {
                caves.push(feature.get("elevation")*world_info.y_resolution)
            }

            if (layer == resourceJSONLayer) {
                resources.push(feature.get("name")+":"+feature.get("coords")[1]);
            }
        });

        // linear interpolation between zl and zh.
        // z-zl * zl  +  zh-z * zh
        // ----          ----          = new coord flipped about the x
        // zh-zl         zh-zl

        // a bunch of algebra later
        // new = zh+zl-z
        var zl = world_info.chunk_zl * 16
        var zh = zl + world_info.tile_0_size

        //console.log("before " + coordinate);
        coordinate[1] = zl + zh - coordinate[1];
        //console.log("after " + coordinate)

        //console.log(myview.getCenter())
        //console.log("zoom: " + myview.getZoom());

        let retval = coordinate[0].toFixed(0) + ", " + coordinate[1].toFixed(0);
        retval += "<br/>" + biome;
        for(let e in entities) {
            retval += "<br/>entities: " + e + " " + entities[e];

        }

        if (spawners.length) {
            retval += "<br/>spawners: " + spawners.join("<br/>");
        }

        for(let e in blockentities) {
            retval += "<br/>blockentities: " + e + " " + blockentities[e];
        }
        retval += "<br>villages:";
        retval += village_sections.join("<br>") + "<br/>";

        retval += "elevations " + elevations.join(", ") + "<br/>";

        retval += "caves " + caves.join(", ") + "<br/>";

        retval += "resources " + resources.join("<br/>") + "<br\>";
        return retval;

    };
    mousePositionControl.setCoordinateFormat(coordinateFormatFunction)


    var center = olExtent.getCenter(mapextent);
    const map = new Map({
        target: 'map',
        controls: [mousePositionControl, overviewMapControl],

        layers: [
            //maplayer,
            biomesJSONlayer,
            resourceJSONLayer,
            entitiesJSONLayer,
            blockEntitiesJSONLayer,
            villagesJSONLayer,
            ChunkBoundsLayer,
            elevationsJSONlayer,
            cavesJSONlayer,
            SlimeChunkLayer,
            //testJSONlayer,
            //new TileLayer({
            //  source: new OSM()
            //})
        ],
        view: myview,
    });

    const interactionElements = document.querySelectorAll('#map-overlay > input');

    const time_report = document.querySelectorAll('#map-overlay > #time_report');
    for (let tr of time_report) {
        tr.innerHTML = world_info.update_time;
    }

    function onInteractionClick(e) {
        console.log(e);
        switch(e.target.value) {
        case 'showBiomes':
            console.log("got show biome event " + e.target.checked)
            biomesJSONlayer.setVisible(e.target.checked);
            break;

        case 'showEntities':
            console.log("got show entities event " + e.target.checked)
            entitiesJSONLayer.setVisible(e.target.checked);
            break;

        case 'showPassives':
            showPassives = e.target.checked;
            entitiesJSONLayer.getSource().refresh();
            break;

        case 'showSlime':
            SlimeChunkLayer.setVisible(e.target.checked);
            break;

        case 'showElevations':
            elevationsJSONlayer.setVisible(e.target.checked);
            break;

        case 'showCaves':
            cavesJSONlayer.setVisible(e.target.checked);
            break;

        case 'showResources':
            resourceJSONLayer.setVisible(e.target.checked);
            break;

        case 'showSurfaceResources':
            showSurfaceResources = e.target.checked;
            resourceJSONLayer.getSource().refresh();
            break;

        default:
            console.log('got unknown click event ' + e.target.value);
            break;
        }
    }

    for(let ble of interactionElements) {
        console.log(ble);
        ble.addEventListener('change', onInteractionClick);
    }


    //var popup = new Overlay({
    //  element: document.getElementById('map-overlay'),
    //  positioning: 'center-right',
    //  position: [100, -500],
    //  autoPan: true,
    //});
    //map.addOverlay(popup);
}
