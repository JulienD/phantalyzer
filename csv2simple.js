var U = require('underscore');
var fs = require('fs');
var csv = require('finite-csv');
var exec = require('child_process').exec;
var path = require('path');

var program = require('commander');

program
  .version('0.0.1')
  .option('-d, --dataDir <path>', 'Data directory')
  .option('-c, --csvFile <path>', 'CVS file containing site list')
  .option('-s, --skipRows [offset]', 'Number of rows to skip in the CSV file before the header.', parseInt, 0)
  .option('-m, --maxRows [count]', 'Max number of records to process.', parseInt, 100000)
  .parse(process.argv);

var records = null;

/* http://howtonode.org/understanding-process-next-tick */
/* https://github.com/jordanryanmoore/spasm/blob/master/lib/spasm.js */

if ( ! (fs.existsSync(program.dataDir) && fs.lstatSync(program.dataDir).isDirectory() ) ) {
  console.error('directory ' + program.dataDir + ' does not exist or is not a directory');
  process.exit(1);
}

/* process the csv file */
if ( ! fs.existsSync(program.csvFile) ) {
  console.error('CSV file ' + program.csvFile + ' does not exist');
  process.exit(1);
}

fs.readFile(program.csvFile, 'utf8', function (err, data) {
  if (err) throw err;
  data = data.replace(/\cm/g, "\n");
  //console.log(data);
  var records = csv.parseCSV(data);
  //console.log(records);

  // skip the first four records because yuri's spreadsheet has a header
  records = records.slice(program.skipRows);
  var sites = csv_to_obj(records);
  //sites = sites.slice(0,3);
  var index = 0;
//console.log(sites);
  console.log("processing " + sites.length + " records...");

  var flowDef = {
    "start" : "ready",
    "transitions" : [
      {
        "from"   : "ready",
        "to"     : "processing",
        "action" : function() {
          currentSite = sites[index++];
          var url = currentSite[' URL ' ].trim();
          console.log("processing site", url);
          if ( currentSite.hasOwnProperty(' Site Description ') && currentSite[' Site Description '].match(/website/i) ) {
            var job = 'phantomjs simple.js "' + url + '"';
            console.log(job); 
            //process.nextTick( function() { wf.processEvent('job_complete'); });
          //setTimeout(function() { console.log('timeout done'); wf.processEvent('job_complete'); }, currentSite.time * 200);
            var child = exec(job,
              function (error, stdout, stderr) {
                var slug = url.replace(/[^-a-zA-Z.0-9]/g, '-').replace(/^https?/i, '').replace(/-+/g, '-').replace(/^-/, '');
                var filename = program.dataDir + path.sep + 'site_' + index + '_' + slug + '.txt';
                if ( fs.existsSync(filename) ) {
                  fs.unlinkSync(filename);
                }
                console.log('writing file ' + filename);
                fs.writeFileSync(filename, stdout);
                //console.log('stdout: ' + stdout);
                console.log(stderr);
                if (error !== null) {
                  console.log('exec error: ' + error);
                }
                process.nextTick(function() { wf.processEvent('job_complete'); });
              }
            );
            
          } else {
            console.log("ignoring due to non-working application status... " + url);
            process.nextTick(function() { wf.processEvent('job_complete'); });
          }
        },
        "guard"  : function() {
          return index < sites.length;
        }
      },
      {
        "from"   : "ready",
        "to"     : "end",
        "guard"  : function() { index >= sites.length; },
      },
      {
        "from"   : "processing",
        "to"     : "ready",
        "event"  : "job_complete",
        "action" : function() {
          console.log("finished processing site");
        }
      }
    ]
  };

  var wf = new FiniteStateMachine(flowDef);
  wf.enterStartState();
});

// at this point we have 

var currentSite = null;
var sites = [
{"name" : "a", "time":4 },
{"name" : "b", "time":5 },
{"name" : "c", "time":6 },
{"name" : "d", "time":7 },
{"name" : "e", "time":8 },
{"name" : "f", "time":9 }
];

/**
 * This awesome function will return an
 * array of rows with the key values of
 * each row matching the column header
 * which should be provided in the first row.
 */
function csv_to_obj(records) {
  var objects = [];
  var header = [];
  for ( var i = 0; i < records.length; i++ ) {
    var values = records[i];
    if ( i == 0 ) {
      header = values;
    } else {
      var item = [];
      for ( var recI = 0; recI < header.length; recI++ ) {
	item[header[recI]] = recI < values.length ? values[recI] : "";
      }
      objects.push(item);
    }
  }
  return objects;
}

function FiniteStateMachine(flow) {
  this.flow = flow;
  this.current = flow.start;

  this.enterStartState = function() {
    this.processEvent();
  }

  /**
   * we need to look at process.nextTick to
   * handle the issue of a massive call stack
   * getting created.  i think this should be
   * done when events are posted.
   */
  this.processEvent = function(eventName) {
    //console.log('state=' + this.current + ' processEvent(' + eventName + ')');
    
    while (true) {
      var foundTransition = false;
      var relevant = false
      for ( var i = 0; i < this.flow.transitions.length; i++ ) {
        var t = this.flow.transitions[i];
        if ( t.from != this.current ) continue;
        if ( t.event != eventName ) continue;
        if ( t.guard == undefined || t.guard() ) {
          relevant = t;
          //console.log('t', t);
          break;
        }
      }
    
      if ( relevant ) {
        console.log('  ' + relevant.from + "\t ==> " + relevant.to);
        this.current = relevant.to;
        eventName = undefined;
        /* if an action is called then it could publish an event */
        if ( relevant.hasOwnProperty('action') ) {
          relevant.action();
        }
      } else {
        return;
      }
    }
  };
}

