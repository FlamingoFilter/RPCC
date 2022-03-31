// Load in the required modules
const Patches = require('Patches');
const Diagnostics = require('Diagnostics');
const Multipeer = require('Multipeer');
const Participants = require('Participants');
const State = require('spark-state');
const Time = require('Time');
const Reactive = require('Reactive');

(async function () { // Enable async/await in JS [part 1]

  // Get the current participant, 'self'
  const self = await Participants.self;

  const round        = await State.createGlobalScalarSignal(0, 'round');
  const noPointsMade = await State.createGlobalPeersMap(0, 'noPointsMade');
  const scores       = await State.createGlobalPeersMap(0, 'scores')
  const moves        = await State.createGlobalPeersMap("", 'moves')

  const selectRock     = await Patches.outputs.getPulse('selectRock');    selectRock.subscribe(()     => {select("Rock"    )});
  const selectPaper    = await Patches.outputs.getPulse('selectPaper');   selectPaper.subscribe(()    => {select("Paper"   )});
  const selectScissors = await Patches.outputs.getPulse('selectScissors');selectScissors.subscribe(() => {select("Scissors")});

  function select(selectedValue){
    selection = selectedValue;
    //Diagnostics.log("Currently selecting " + selection);
    Patches.inputs.setString('selection', selection);
  }

  let reset = function(){
    Diagnostics.log("Reset")
    movesToReceiveBeforeScoring = 0
    scoresToReceiveBeforeAllowingNewRound = 0
    myMove = undefined
    allOtherMoves = []
    select("Chicken")
    roundIsFinished = true
  }

  let movesToReceiveBeforeScoring = 0
  let scoresToReceiveBeforeAllowingNewRound = 0

  let myMove
  let allOtherMoves = []

  let onSomeoneMoved = function(id, event){
    // Diagnostics.log(id + " move has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    if(id != self.id && event.newValue != "") Diagnostics.log(id + " played '" + event.newValue + "'.");

    if(self.id != id) allOtherMoves.push(event.newValue)

    if(event.newValue != ""){
      movesToReceiveBeforeScoring--
      if(movesToReceiveBeforeScoring <= 0){
        movesToReceiveBeforeScoring = 0
        let pointsObtained = computeScoreChange(myMove,allOtherMoves)
        Diagnostics.log("Points obtained : " + pointsObtained + " by playing '" + myMove + "'.");
        if(pointsObtained != 0){
          (async function () {
            let myScore = (await scores.get(self.id))
            let myNewScore = (myScore.pinLastValue() + pointsObtained)
            myScore.increment(pointsObtained);
            Patches.inputs.setString('score', myNewScore.toString());
          })();
        }
        else {
          (async function () {
            (await noPointsMade.get(self.id)).increment(1);
          })();
        }
      }
      else {
        Diagnostics.log("Expecting " + movesToReceiveBeforeScoring + " more moves before counting...")
      }
    }
  };

  let onSomeoneScored = function(id, event){
    // if(event) Diagnostics.log(id + " score has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    // else Diagnostics.log(id + " score hasn't changed.")

    scoresToReceiveBeforeAllowingNewRound--
    if(scoresToReceiveBeforeAllowingNewRound <= 0){
      scoresToReceiveBeforeAllowingNewRound = 0
      Patches.inputs.setPulse('roundFinished', Reactive.once());
      // Diagnostics.log("New round allowed !")
      moves.set(self.id,"");
      reset()
    }
    else {
      Diagnostics.log("Expecting " + scoresToReceiveBeforeAllowingNewRound + " more scores update before allowing new round...")
    }
  }

  moves.setOnNewPeerCallback(       function(id){(async function () {(await        moves.get(id)).monitor().subscribe((event) => {onSomeoneMoved (id, event)});})();});
  scores.setOnNewPeerCallback(      function(id){(async function () {(await       scores.get(id)).monitor().subscribe((event) => {onSomeoneScored(id, event)});})();});
  noPointsMade.setOnNewPeerCallback(function(id){(async function () {(await noPointsMade.get(id)).monitor().subscribe((event) => {onSomeoneScored(id, null )});})();});

  function computeScoreChange(myMove, allOtherMoves){
    let scoreChange = 0
    let allTheOthersPlayedChicken = true

    // Diagnostics.log("Computing score with my move : " + myMove + " against " + JSON.stringify(allOtherMoves));

    for(let i = 0; i < allOtherMoves.length; i++){
      let otherMove = allOtherMoves[i]

      if(otherMove != "Chicken") allTheOthersPlayedChicken = false

      if(myMove == "Rock"){
        if      (otherMove == "Rock")    {} 
        else if (otherMove == "Paper")   scoreChange--
        else if (otherMove == "Scissors") scoreChange++
      }
      else if(myMove == "Paper"){
        if      (otherMove == "Rock")    scoreChange++ 
        else if (otherMove == "Paper")   {}
        else if (otherMove == "Scissors") scoreChange--
      }
      else if(myMove == "Scissors"){
        if      (otherMove == "Rock")    scoreChange-- 
        else if (otherMove == "Paper")   scoreChange++
        else if (otherMove == "Scissors") {}
      }
    }

    // Extra rule : if you don't play chicken, but all the others do, you win something
    if(myMove != "Chicken" && allTheOthersPlayedChicken && allOtherMoves.length > 0){
      scoreChange++
    }

    return scoreChange
  }

  let selection = "Chicken"

  let roundIsFinished = true
  const startRound = await Patches.outputs.getPulse('startRound');
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
    Patches.inputs.setPulse('roundStarted', Reactive.once());

    (async function () {
      // Get the other call participants
      const participants = await Participants.getOtherParticipantsInSameEffect();
      movesToReceiveBeforeScoring = participants.length + 1
      scoresToReceiveBeforeAllowingNewRound = participants.length + 1
      Diagnostics.log("Round started with " + (participants.length + 1) + " participants.");
    })();

    // Starts a 10 seconds timer
    let timer = Time.setTimeout(function() {
      Patches.inputs.setPulse('waitingForResults', Reactive.once());
      Diagnostics.log("10 seconds passed : You played '" + selection + "'.")
      moves.set(self.id,selection);
      myMove = selection
    }, 10000);
  });

  // Get the other call participants
  const participants = await Participants.getOtherParticipantsInSameEffect();
  participants.push(self);

  for(let key in participants){
    Diagnostics.log("Participant ID : " + participants[key].id);
    (async function () {
      let id = participants[key].id;
      (await moves.get(id)).monitor().subscribe((event) => {
        onSomeoneMoved(id,event)
      });
      (await scores.get(id)).monitor().subscribe((event) => {
        onSomeoneScored(id,event)
      });
      (await noPointsMade.get(id)).monitor().subscribe((event) => {
        onSomeoneScored(id,null)
      });
    })();
  }

  Patches.inputs.setString('score', "0");
  Diagnostics.log("Game loaded !")
})(); // Enable async/await in JS [part 2]
