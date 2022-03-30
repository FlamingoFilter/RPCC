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

  let onSomeoneMoved = function(id, event){
    Diagnostics.log(id + " move has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
  };

  moves.setOnNewPeerCallback(function(id){
    (async function () {
      (await moves.get(id)).monitor().subscribe((event) => {
        onSomeoneMoved(id,event)
      });
    })();
  });

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

  // Get the other call participants
  const participants = await Participants.getAllOtherParticipants();
  participants.push(self);

  for(let key in participants){
    Diagnostics.log("Participant ID : " + participants[key].id);
    (async function () {
      (await moves.get(participants[key].id)).monitor().subscribe((event) => {
        onSomeoneMoved(participants[key].id,event)
      });
    })();
  }

  Diagnostics.log("Game loaded !")
})(); // Enable async/await in JS [part 2]
