// Load in the required modules
const Patches = require('Patches');
const Diagnostics = require('Diagnostics');
const Multipeer = require('Multipeer');
const Participants = require('Participants');
const State = require('spark-state');
const Time = require('Time');
const Reactive = require('Reactive');
const Scene = require('Scene');
const Materials = require('Materials');

(async function () { // Enable async/await in JS [part 1]

  // Get the current participant, 'self'
  const self = await Participants.self;

  const round        = await State.createGlobalScalarSignal(0, 'round');
  const noPointsMade = await State.createGlobalPeersMap(0, 'noPointsMade');
  const scores       = await State.createGlobalPeersMap(0, 'scores')
  const moves        = await State.createGlobalPeersMap("", 'moves')
  const ready        = await State.createGlobalPeersMap(0, 'ready');

  const selectRock     = await Patches.outputs.getPulse('selectRock');    selectRock.subscribe(()     => {select("Rock"    )});
  const selectPaper    = await Patches.outputs.getPulse('selectPaper');   selectPaper.subscribe(()    => {select("Paper"   )});
  const selectScissors = await Patches.outputs.getPulse('selectScissors');selectScissors.subscribe(() => {select("Scissors")});

  const myMoveRect = await Scene.root.findFirst("myMoveRect")

  const rockMaterial        = await Materials.findFirst('rockMaterial')
  const paperMaterial       = await Materials.findFirst('paperMaterial')
  const scissorsMaterial    = await Materials.findFirst('scissorsMaterial')
  const transparentMaterial = await Materials.findFirst('transparentMaterial')

  function select(selectedValue){
    selection = selectedValue;
    //Diagnostics.log("Currently selecting " + selection);
    Patches.inputs.setString('selection', selection);
    switch(selection){
      case "Rock"     : myMoveRect.material = rockMaterial;        break;
      case "Paper"    : myMoveRect.material = paperMaterial;       break;
      case "Scissors" : myMoveRect.material = scissorsMaterial;    break;
      default         : myMoveRect.material = transparentMaterial; break;
    }
  }

  let onRoundEnds = function(){
    Diagnostics.log("onRoundEnds")
    movesToReceiveBeforeScoring = 0
    scoresToReceiveBeforeAllowingNewRound = 0
    select("Chicken")
    myMove = "Chicken"
    allOtherMoves = []
    allOtherScores = []
    roundIsFinished = true
    onScoreTimeOut = function(){}
    onMoveTimeOut = function(){}
  }

  let movesToReceiveBeforeScoring = 0
  let scoresToReceiveBeforeAllowingNewRound = 0

  let myMove = "Chicken"
  select("Chicken")
  let allOtherMoves = []

  let myScore = 0
  let allOtherScores = []

  let onScoreTimeOut = function(){}
  let onMoveTimeOut = function(){}

  async function onEveryoneMoved(){
    Patches.inputs.setPulse('showMove', Reactive.once());

    // Starts a 3 seconds timer before counting our score, for seeing moves made by everyone
    let timer = Time.setTimeout(async function() {
      let pointsObtained = computeScoreChange(myMove,allOtherMoves)
      Diagnostics.log("Points obtained : " + pointsObtained + " by playing '" + myMove + "' against " + JSON.stringify(allOtherMoves) + ".");
      scoresToReceiveBeforeAllowingNewRound = await howManyUsersAreReady()

      if(pointsObtained != 0){
        (async function () {
          let myCurrentScore = (await scores.get(self.id))
          let myNewScore = (myCurrentScore.pinLastValue() + pointsObtained)
          myCurrentScore.increment(pointsObtained);
          await Patches.inputs.setString('score', myNewScore.toString());
          await Patches.inputs.setString('pointsObtained', pointsObtained > 0 ? "+ " + pointsObtained.toString() : "- " + (-pointsObtained).toString());
          await Patches.inputs.setPulse('pointsObtainedPulse', Reactive.once());
        })();
      }
      else {
        (async function () {
          (await noPointsMade.get(self.id)).increment(1);
        })();
      }

      onScoreTimeOut = function() {
        if(scoresToReceiveBeforeAllowingNewRound > 0){
          Diagnostics.log("6 seconds passed after scoring, some scores are still missing.")
          scoresToReceiveBeforeAllowingNewRound = 0
          onEveryoneScored()
        }
      }

      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its result after a few seconds
      let timer = Time.setTimeout(function(){onScoreTimeOut()}, 6000);
    }, 3000);
  }

  let onSomeoneMoved = function(id, event){
    // Debug prints
    // Diagnostics.log(id + " move has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    if(id != self.id && event.newValue != "") Diagnostics.log(id + " played '" + event.newValue + "'.");

    (async function () {
      if(event.newValue != ""){ // Ignore specific values
        movesToReceiveBeforeScoring--

        // Discard unwanted datas
        if(movesToReceiveBeforeScoring < 0){
          Diagnostics.log("Received a move while not waiting any move (anymore).")
          movesToReceiveBeforeScoring = 0;
          return;
        }

        // Save into local structures
        if(self.id != id) allOtherMoves.push(event.newValue)

        // React if all data has been received
        if(movesToReceiveBeforeScoring == 0){
          onEveryoneMoved()
        }
        else {
          Diagnostics.log("Expecting " + movesToReceiveBeforeScoring + " more moves before counting...")
        }
      }
    })();
  };

  async function onEveryoneScored(){
    // Winner calculation
    let win = allOtherScores.length > 0
    for(let key in allOtherScores){
      let score = allOtherScores[key]
      if(myScore <= score){
        win = false;
        break;
      }
    }

    await Patches.inputs.setBoolean('win', win);

    Patches.inputs.setPulse('roundFinished', Reactive.once());
    // Diagnostics.log("New round allowed !")
    moves.set(self.id,"");
    onRoundEnds()
  }

  let onSomeoneScored = function(id, event){
    // if(event) Diagnostics.log(id + " score has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    // else Diagnostics.log(id + " score hasn't changed.")

    (async function () {
      scoresToReceiveBeforeAllowingNewRound--

      // Discard unwanted datas
      if(scoresToReceiveBeforeAllowingNewRound < 0){
        Diagnostics.log("Received a score while not waiting any score (anymore).")
        scoresToReceiveBeforeAllowingNewRound = 0;
        return;
      }

      // Save into local structures
      if(self.id != id) {
          allOtherScores.push((await scores.get(id)).pinLastValue());
      }
      else {
          myScore = (await scores.get(id)).pinLastValue();
      }

      // React if all data has been received
      if(scoresToReceiveBeforeAllowingNewRound == 0){
        onEveryoneScored()
      }
      else {
        Diagnostics.log("Expecting " + scoresToReceiveBeforeAllowingNewRound + " more scores update before allowing new round...")
      }
    })();
  }

  moves.setOnNewPeerCallback(       function(id){(async function () {(await        moves.get(id)).monitor().subscribe((event) => {onSomeoneMoved (id, event)});})();});
  scores.setOnNewPeerCallback(      function(id){(async function () {(await       scores.get(id)).monitor().subscribe((event) => {onSomeoneScored(id, event)});})();});
  noPointsMade.setOnNewPeerCallback(function(id){(async function () {(await noPointsMade.get(id)).monitor().subscribe((event) => {onSomeoneScored(id, null )});})();});

  function computeScoreChange(myMove, allOtherMoves){
    let scoreChange = 0
    let allTheOthersPlayedChicken = true

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

  async function howManyUsersAreReady(){
    const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
      let countOfParticipantsReady = 0
      for(let key in othersParticipants){
        let id = othersParticipants[key].id
        Diagnostics.log("Other Participant ID : " + id + " is online.");
        if((await ready.get(id)).pinLastValue() == 1){
          countOfParticipantsReady++
          Diagnostics.log("Other Participant ID : " + id + " is ready to play.");
        }
      }
      return countOfParticipantsReady + 1;// Adding ourself
  }

  round.monitor().subscribe((event) => {
    roundIsFinished = false
    Diagnostics.log("Starting round " + round.pinLastValue() + ".");
    Patches.inputs.setPulse('roundStarted', Reactive.once());

    (async function () {
      movesToReceiveBeforeScoring = await howManyUsersAreReady()
      //scoresToReceiveBeforeAllowingNewRound = movesToReceiveBeforeScoring
      Diagnostics.log("Round started with " + movesToReceiveBeforeScoring + " participants.");
    })();

    // Starts a 10 seconds timer
    let timer = Time.setTimeout(function() {
      Patches.inputs.setPulse('waitingForResults', Reactive.once());
      Diagnostics.log("10 seconds passed : You played '" + selection + "'.")
      moves.set(self.id,selection);
      myMove = selection

      onMoveTimeOut = function() {
        if(movesToReceiveBeforeScoring > 0){
          Diagnostics.log("6 seconds passed after play, some results are still missing.")
          movesToReceiveBeforeScoring = 0
          onEveryoneMoved()
        }
      }

      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its result after a few seconds
      let timer = Time.setTimeout(function(){onMoveTimeOut()}, 6000);

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
  (await ready.get(self.id)).increment(1)
  Diagnostics.log("Game loaded !")
})(); // Enable async/await in JS [part 2]
