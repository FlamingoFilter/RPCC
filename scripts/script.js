// Load in the required modules
const Patches = require('Patches');
const Diagnostics = require('Diagnostics');
const Multipeer = require('Multipeer');
const Participants = require('Participants');
const State = require('spark-state');
const Time = require('Time');

(async function () { // Enable async/await in JS [part 1]

  // Get the current participant, 'self'
  const self = await Participants.self;

  const screenTapPulse = await Patches.outputs.getPulse('screenTapPulse');
  const startRound     = await Patches.outputs.getPulse('startRound');

  const round = await State.createGlobalScalarSignal(0, 'round');
  const noPointsMade = await State.createGlobalScalarSignal(0, 'noPointsMade');
  const scores = await State.createGlobalPeersMap(0, 'scores')
  const moves = await State.createGlobalPeersMap("", 'moves')

  let onEachId = async function(funct){
    const participants = await Participants.getAllOtherParticipants();
    participants.push(self);

    for(let key in participants){
      funct(participants[key].id)
    }
  }

  let movesToReceiveBeforeScoring = 0
  let scoresToReceiveBeforeAllowingNewRound = 0

  let myMove
  let allOtherMoves = []

  let onSomeoneMoved = function(id, event){
    //Diagnostics.log(id + " move has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    if(id != self.id && event.newValue != "") Diagnostics.log(id + " played '" + event.newValue + "'.");

    if(self.id != id) allOtherMoves.push(event.newValue)
    else myMove = event.newValue

    if(event.newValue != ""){
      movesToReceiveBeforeScoring--
      if(movesToReceiveBeforeScoring <= 0){
        movesToReceiveBeforeScoring = 0
        let pointsObtained = computeScoreChange(myMove,allOtherMoves)
        Diagnostics.log("Points obtained : " + pointsObtained);
        if(pointsObtained != 0){
          (async function () {
            (await scores.get(self.id)).increment(pointsObtained);
          })();
        }
        else noPointsMade.set(noPointsMade.pinLastValue() + 1)
      }
      else {
        Diagnostics.log("Expecting " + movesToReceiveBeforeScoring + " more moves before counting...")
      }
    }
  };

  noPointsMade.monitor().subscribe((event) => {
    onSomeoneScored("Someone", null)
  });

  let onSomeoneScored = function(id, event){
    
    if(event)
      Diagnostics.log(id + " score has changed from '" + event.oldValue + "' to '" + event.newValue + "'");

    scoresToReceiveBeforeAllowingNewRound--
    if(scoresToReceiveBeforeAllowingNewRound <= 0){
      scoresToReceiveBeforeAllowingNewRound = 0
      roundIsFinished = true
      Diagnostics.log("New round allowed !")
      moves.set(self.id,"");
    }
    else {
      Diagnostics.log("Expecting " + scoresToReceiveBeforeAllowingNewRound + "more scores update before allowing new round...")
    }
  }

  moves.setOnNewPeerCallback(function(id){
    (async function () {
      Diagnostics.log("New participant ID : " + id);
      (await moves.get(id)).monitor().subscribe((event) => {
        onSomeoneMoved(id,event)
      });
      (await scores.get(id)).monitor().subscribe((event) => {
        onSomeoneScored(id,event)
      });
    })();
  });

  function computeScoreChange(myMove, allOtherMoves){
    let scoreChange = 0
    let allTheOthersPlayedChicken = true

    for(let i = 0; i < allOtherMoves.length; i++){
      let otherMove = allOtherMoves[i]

      if(otherMove != "Chicken") allTheOthersPlayedChicken = false

      if(myMove == "Rock"){
        if      (otherMove == "Rock")    {} 
        else if (otherMove == "Paper")   scoreChange--
        else if (otherMove == "Cissors") scoreChange++
      }
      else if(myMove == "Paper"){
        if      (otherMove == "Rock")    scoreChange++ 
        else if (otherMove == "Paper")   {}
        else if (otherMove == "Cissors") scoreChange--
      }
      else if(myMove == "Cissors"){
        if      (otherMove == "Rock")    scoreChange-- 
        else if (otherMove == "Paper")   scoreChange++
        else if (otherMove == "Cissors") {}
      }
    }

    // Extra rule : if you don't play chicken, but all the others do, you win something
    if(myMove != "Chicken" && allTheOthersPlayedChicken){
      scoreChange++
    }

    return scoreChange
  }

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
  startRound.subscribe(function() {
    if (roundIsFinished) {
      round.set(round.pinLastValue() + 1);
    }
    else {
      Diagnostics.log("Cannot start a new round because a round has started and all moves are not empty again.");
    }
  });

  round.monitor().subscribe((event) => {
    roundIsFinished = false
    Diagnostics.log("Starting round " + round.pinLastValue() + ".");

    (async function () {
      // Get the other call participants
      const participants = await Participants.getAllOtherParticipants();
      movesToReceiveBeforeScoring = participants.length + 1
      scoresToReceiveBeforeAllowingNewRound = participants.length + 1
    })();

    // TODO Add a visual round animation


    // Starts a 3 seconds timer
    let timer = Time.setTimeout(function() {
      Diagnostics.log("3 seconds passed : You played '" + selection + "'.")
      moves.set(self.id,selection);
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
      (await scores.get(participants[key].id)).monitor().subscribe((event) => {
        onSomeoneScored(participants[key].id,event)
      });
    })();
  }

  Diagnostics.log("Game loaded !")
})(); // Enable async/await in JS [part 2]
