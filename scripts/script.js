// Load in the required modules
const Patches = require('Patches');
const Diagnostics = require('Diagnostics');
const Multipeer = require('Multipeer');
const Participants = require('Participants');
const State = require('spark-state');
const Time = require('Time');

(async function () { // Enable async/await in JS [part 1]

  const round = await State.createGlobalScalarSignal(0, 'round');
  const scores = await State.createGlobalPeersMap(0, 'scores')
  const moves = await State.createGlobalPeersMap("", 'moves')

  const screenTapPulse     = await Patches.outputs.getPulse('screenTapPulse');
  const screenTapHoldPulse = await Patches.outputs.getPulse('screenTapHoldPulse');

  // Get the current participant, 'self'
  const self = await Participants.self;

  let selection = "Chicken"

  screenTapPulse.subscribe(() => {
    // switch selection
    if     (selection == "Chicken") selection = "Rock"
    else if(selection == "Rock")    selection = "Paper"
    else if(selection == "Paper")   selection = "Cissors"
    else if(selection == "Cissors") selection = "Chicken"
    Diagnostics.log("Currently selecting " + selection);
  });

  let roundIsFinished = true
  screenTapHoldPulse.subscribe(function() {
    if (roundIsFinished) {
      round.set(round.pinLastValue() + 1);
    }
  });

  round.monitor().subscribe((event) => {
    roundIsFinished = false
    Diagnostics.log("Starting round " + round.pinLastValue());

    // Starts a 3 seconds timer
    let timer = Time.setTimeout(function() {
      Diagnostics.log("3 seconds passed !")
      roundIsFinished = true;

      moves.set(self.id,selection);

      (async function () {
        Diagnostics.log("Played '" + selection + "' with current score of " + (await scores.get(self.id)).pinLastValue());
      })();
    }, 3000);
  });

  (async function () {
    (await moves.get(self.id)).monitor().subscribe((event) => {
      Diagnostics.log("My move has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    });
  })();

})(); // Enable async/await in JS [part 2]
