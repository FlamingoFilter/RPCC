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
const Random = require('Random');

(async function () { // Enable async/await in JS [part 1]

  let debug = true

  // Get the current participant, 'self'
  const self = await Participants.self;
  Patches.inputs.setString("playerID", self.id.split("_")[2]);

  const round        = await State.createGlobalScalarSignal(0, 'round');
  const noPointsMade = await State.createGlobalPeersMap(0, 'noPointsMade');
  const scores       = await State.createGlobalPeersMap(0, 'scores')
  const moves        = await State.createGlobalPeersMap("", 'moves')
  const ready        = await State.createGlobalPeersMap(0, 'ready');
  const effects      = await State.createGlobalPeersMap("", 'effects')

  const selectRock     = await Patches.outputs.getPulse('selectRock');        selectRock.subscribe(() => {select("Rock"    )});
  const selectPaper    = await Patches.outputs.getPulse('selectPaper');      selectPaper.subscribe(() => {select("Paper"   )});
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

  let didIStartThisGame = false

  let movesToReceiveBeforeScoring = 0
  let scoresToReceive = 0
  let movesToResetBeforeContinuing = 0

  let myMove = "Chicken"
  select("Chicken")
  let allOtherMoves = []

  let myScore = 0
  let allOtherScores = []

  if (debug) Patches.inputs.setString('setDebugText', "Waiting for\nanother player.")

  // let onScoreTimeOut = function(){}
  // let onMoveTimeOut = function(){}
  // let onMoveResetTimeOut = function(){}
  let onUserLeft = function(id){}

  async function onEveryoneMoved(){
    
    onUserLeft = function(id){
      movesToResetBeforeContinuing--
      onSomeoneScored(id, null)
    };

    if (debug) Patches.inputs.setString('setDebugText', "Waiting\n3 seconds.")

    Patches.inputs.setPulse('showMove', Reactive.once());

    // Starts a 3 seconds timer before counting our score, for seeing moves made by everyone
    let timer = Time.setTimeout(async function() {
      let pointsObtained = computeScoreChange(myMove,allOtherMoves)
      Diagnostics.log("Points obtained : " + pointsObtained + " by playing '" + myMove + "' against " + JSON.stringify(allOtherMoves) + ".");

      if (debug) Patches.inputs.setString('setDebugText', "Waiting\n" + scoresToReceive + " scores.")

      if(pointsObtained != 0){
        (async function () {
          let myCurrentScore = (await scores.get(self.id))
          myCurrentScore.increment(pointsObtained);
          await Patches.inputs.setString('pointsObtained', pointsObtained > 0 ? "+ " + pointsObtained.toString() : "- " + (-pointsObtained).toString());
          await Patches.inputs.setPulse('pointsObtainedPulse', Reactive.once());
        })();
      }
      else {
        (async function () {
          (await noPointsMade.get(self.id)).increment(1);
        })();
      }

      // onScoreTimeOut = function() {
      //   if(scoresToReceive > 0){
      //     Diagnostics.log("6 seconds passed after scoring, some scores are still missing.")
      //     scoresToReceive = 0
      //     onEveryoneScored()
      //   }
      // }

      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its result after a few seconds
      //let timer = Time.setTimeout(function(){onScoreTimeOut()}, 6000);
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
          if (debug) Patches.inputs.setString('setDebugText', "Waiting for\n" + movesToReceiveBeforeScoring + " moves.")
          Diagnostics.log("Expecting " + movesToReceiveBeforeScoring + " more moves before counting...")
        }
      }
      else {
        // Check if everyone has well reset it's move
        movesToResetBeforeContinuing--

        // Discard unwanted datas
        if(movesToResetBeforeContinuing < 0){
          Diagnostics.log("Received a move reset while not waiting any move reset (anymore).")
          movesToResetBeforeContinuing = 0;
          return;
        }

        // React if all data has been received
        if(movesToResetBeforeContinuing == 0){
          onEveryoneResettedItsMove()
        }
        else {
          if (debug) Patches.inputs.setString('setDebugText', "Waiting\n" + movesToResetBeforeContinuing + " moves reset.")
          Diagnostics.log("Expecting " + movesToResetBeforeContinuing + " more move reset before continuing...")
        }
      }
    })();
  };

  async function onEveryoneResettedItsMove(){
    
    onUserLeft = function(id){};

    if (debug) Patches.inputs.setString('setDebugText', "Waiting for\ngame end.")

    let highestScore = myScore
    let highestScoreCount = 1
    for(let i = 0; i < allOtherScores.length; i++){
      let score = allOtherScores[i]
      if(highestScore < score){
        highestScore = score;
        highestScoreCount = 1;
      }
      else if(highestScore == score){
        highestScoreCount++;
      }
    }
    // Diagnostics.log("The highest score is actually " + highestScore + " and " + highestScoreCount + " player haves it.")
    if(highestScoreCount > 1){ // If there is no winner yet
      //if(didIStartThisGame){ // If we are the player that started this game
        // Diagnostics.log("Auto start of the next round.")
        round.set(round.pinLastValue() + 1); // We launch the next round automatically
      //}
    }
    else {
      // Someone won.
      gameIsFinished = true

      let playerScore = (await scores.get(self.id))
      playerScore.decrement(playerScore.pinLastValue());

      // if(didIStartThisGame){ // The starter player flushes everyones current score
      //   const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
      //   for(let key in othersParticipants){
      //       let id = othersParticipants[key].id
      //       let playerScore = (await scores.get(id))
      //       playerScore.decrement(playerScore.pinLastValue());
      //   }
      //   // And his own score ofc
      //   let playerScore = (await scores.get(self.id))
      //   playerScore.decrement(playerScore.pinLastValue());
      // }
      didIStartThisGame = false;
      (await ready.get(self.id)).increment(1)
    }
  }

  let possibleEffects = [
    {"target" : "others", "name" : "clownNose"}
   ,{"target" : "others", "name" : "drunkMarker"}
  ]

  let targetFromEffect = {}
  for(let key in possibleEffects){
    let effect = possibleEffects[key]
    targetFromEffect[effect.name] = effect.target
  }

  async function onEveryoneScored(){

    onUserLeft = function(id){
      onSomeoneMoved(id, {"newValue" : ""})
    };

    if (debug) Patches.inputs.setString('setDebugText', "Waiting\n" + movesToResetBeforeContinuing + " moves reset.")

    // Winner calculation
    let win = allOtherScores.length > 0
    for(let key in allOtherScores){
      let score = allOtherScores[key]
      if(myScore <= score){
        win = false;
        break;
      }
    }

    let effect = possibleEffects[Math.round(1000000 * Random.random()) % possibleEffects.length]

    if(win){
      // Inflicts an effect
      if(effect.target == "others"){
        const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
        for(let key in othersParticipants){
          let id = othersParticipants[key].id
          Diagnostics.log("Inflicting effect " + effect.name + " on ID : " + id + ".");
          let previousEffects = (await effects.get(id)).pinLastValue();
          if(!previousEffects.includes(effect.name)) // Prevent stacking the same effect multiple times
            effects.set(id, previousEffects + effect.name + "|");
        }

        let previousEffects = (await effects.get(self.id)).pinLastValue() || "";
        let allMyPreviousEffects = previousEffects.split("|")
        allMyPreviousEffects.shift() // Remove first
        effects.set(self.id, allMyPreviousEffects.join("|"));
      }
      else if(effect.target == "myself"){
        Diagnostics.log("Inflicting effect " + effect.name + " on myself.");
        let previousEffects = (await effects.get(self.id)).pinLastValue() || "";
        let allMyPreviousEffects = previousEffects.split("|")
        allMyPreviousEffects.shift() // Remove first
        effects.set(self.id, allMyPreviousEffects.join("|") + effect.name + "|");
      }
    }

    await Patches.inputs.setBoolean('win', win);

    (async function () {
      
      // onMoveResetTimeOut = function() {
      //   if(movesToResetBeforeContinuing > 0){
      //     Diagnostics.log("6 seconds passed after scoring, some resets are still missing.")
      //     movesToResetBeforeContinuing = 0
      //     onEveryoneResettedItsMove()
      //   }
      // }

      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its move reset after a few seconds
      // let timer = Time.setTimeout(function(){onMoveResetTimeOut()}, 6000);
    })();

    moves.set(self.id,"");

    Patches.inputs.setPulse('roundFinished', Reactive.once());
  }

  let onSomeoneScored = function(id, event){
    // if(event) Diagnostics.log(id + " score has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    // else Diagnostics.log(id + " score hasn't changed.")

    (async function () {
      if(id == self.id){
        Patches.inputs.setString('score', ((await scores.get(self.id)).pinLastValue()).toString());
      }
    })();

    (async function () {
      scoresToReceive--

      // Discard unwanted datas
      if(scoresToReceive < 0){
        if(!gameIsFinished) Diagnostics.log("Received a score while not waiting any score (anymore).")
        scoresToReceive = 0;
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
      if(scoresToReceive == 0){
        onEveryoneScored()
      }
      else {
        if (debug) Patches.inputs.setString('setDebugText', "Waiting\n" + scoresToReceive + " scores.")
        Diagnostics.log("Expecting " + scoresToReceive + " more scores update before allowing new round...")
      }
    })();
  }

  moves.setOnNewPeerCallback(       function(id){(async function () {(await        moves.get(id)).monitor().subscribe((event) => {onSomeoneMoved (     id, event)});})();});
  scores.setOnNewPeerCallback(      function(id){(async function () {(await       scores.get(id)).monitor().subscribe((event) => {onSomeoneScored(     id, event)});})();});
  noPointsMade.setOnNewPeerCallback(function(id){(async function () {(await noPointsMade.get(id)).monitor().subscribe((event) => {onSomeoneScored(     id, null )});})();});

  ready.setOnNewPeerCallback(function(id){ // When a new player joins
    (async function () {
      if(gameIsFinished){
        Diagnostics.log(id + " joined while " + self.id + " is not playing yet.");
        (await       ready.get(self.id)).increment(1); // We say again to everyone that we are ready if we re not playing now
      }
      (await ready.get(id)).monitor().subscribe((event) => {onSomeoneReady(     id, event)});
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

  let gameIsFinished = true
  const startGame = await Patches.outputs.getPulse('startGame');
  startGame.subscribe(function() {
    (async function () {
      // Everyone needs to be ready to start a game
      const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
      for(let key in othersParticipants){
        let id = othersParticipants[key].id
        if((await ready.get(id)).pinLastValue() >= 1){
          continue
        }
        else{
          // Reject the start request
          return;
        }
      }

      if(othersParticipants.length == 0){
        // Reject the start request
        return;
      }

      if (gameIsFinished) {
        didIStartThisGame = true
        round.set(round.pinLastValue() + 1);
      }
      else {
        Diagnostics.log("Cannot start a new round because a round has started and all moves are not empty again.");
      }
    })();
  });

  async function howManyUsersAreReady(){
    const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
    let countOfParticipantsReady = 0
    for(let key in othersParticipants){
      let id = othersParticipants[key].id
      // Diagnostics.log("Other Participant ID : " + id + " is online.");
      if((await ready.get(id)).pinLastValue() >= 1){
        countOfParticipantsReady++
        // Diagnostics.log("Other Participant ID : " + id + " is ready to play.");
      }
    }
    return countOfParticipantsReady + 1;// Adding ourself
  }

  round.monitor().subscribe((event) => {
    Diagnostics.log("Starting round " + round.pinLastValue() + ".");

    movesToReceiveBeforeScoring = 0
    scoresToReceive = 0
    movesToResetBeforeContinuing = 0
    select("Chicken")
    myMove = "Chicken"
    allOtherMoves = []
    allOtherScores = []
    gameIsFinished = false;

    Patches.inputs.setBoolean('win', false);
    Patches.inputs.setBoolean('canStart', false)
    Patches.inputs.setPulse('roundStarted', Reactive.once());

    (async function () {
      let howManyUsersArePlaying      = await howManyUsersAreReady()
      movesToReceiveBeforeScoring           = howManyUsersArePlaying
      scoresToReceive = howManyUsersArePlaying
      movesToResetBeforeContinuing          = howManyUsersArePlaying
      Diagnostics.log("Round started with " + howManyUsersArePlaying + " participants.");
    })();

    onUserLeft = function(id){
      scoresToReceive--
      movesToResetBeforeContinuing--
      onSomeoneMoved(id, {"newValue" : "Chicken"})
    };

    if (debug) Patches.inputs.setString('setDebugText', "Waiting\n10 seconds.")

    // Starts a 10 seconds timer
    let timer = Time.setTimeout(function() {
      if (debug) Patches.inputs.setString('setDebugText', "Waiting for\n" + movesToReceiveBeforeScoring + " moves.")
      Patches.inputs.setPulse('waitingForResults', Reactive.once());
      Diagnostics.log("10 seconds passed : You played '" + selection + "'.")
      moves.set(self.id,selection);
      myMove = selection

      // onMoveTimeOut = function() {
      //   if(movesToReceiveBeforeScoring > 0){
      //     Diagnostics.log("6 seconds passed after play, some results are still missing.")
      //     movesToReceiveBeforeScoring = 0
      //     onEveryoneMoved()
      //   }
      // }

      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its result after a few seconds
      // let timer = Time.setTimeout(function(){onMoveTimeOut()}, 6000);

    }, 10000);
  });

  let onSomeoneReady = async function(id, event){
    let everyoneIsReady = true
    Diagnostics.log(id + " is now ready.")

    const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
    for(let key in othersParticipants){
      let id = othersParticipants[key].id
      if((await ready.get(id)).pinLastValue() >= 1){
        continue
      }
      else {
        if (debug) Patches.inputs.setString('setDebugText', "Waiting\nplayer " + id.split("_")[2] + "!")
        Diagnostics.log(id + " is not ready.")
        everyoneIsReady = false;
        break;
      }
    }

    if(everyoneIsReady && othersParticipants.length > 0 && gameIsFinished){
      if (debug) Patches.inputs.setString('setDebugText', "")
      Patches.inputs.setBoolean('canStart', true)
    }
  }

  // Get the other call participants
  const activeParticipants = await Participants.getOtherParticipantsInSameEffect();
  activeParticipants.push(self);

  for(let key in activeParticipants){
    Diagnostics.log("Participant ID : " + activeParticipants[key].id);
    (async function () {
      let id = activeParticipants[key].id;
      (await        moves.get(id)).monitor().subscribe((event) => {onSomeoneMoved(       id, event)});
      (await       scores.get(id)).monitor().subscribe((event) => {onSomeoneScored(      id, event)});
      (await noPointsMade.get(id)).monitor().subscribe((event) => {onSomeoneScored(      id, null)});
      (await        ready.get(id)).monitor().subscribe((event) => {onSomeoneReady(       id, event)});
    })();
  }

  (await effects.get(self.id)).monitor().subscribe((event) => {
    // Diagnostics.log("New effects for me : '" + event.newValue + "'.")
    Patches.inputs.setString('myEffects', event.newValue)
  });

  Patches.inputs.setString('score', "0");

  (await ready.get(self.id)).increment(1);
  (await onSomeoneReady(self.id, null));


  // --------------------------------------------------------------------------------------------
  // Get the other call participants
  const participants = await Participants.getAllOtherParticipants();

  // Get each participant in the participant list
  participants.forEach(function(participant) {

    // Monitor each participant's isActiveInSameEffect status
    // The use of subscribeWithSnapshot here allows us to capture the participant who
    // triggered the event (ie enters or leaves the call) inside of the callback
    participant.isActiveInSameEffect.monitor().subscribeWithSnapshot({
      userIndex: participants.indexOf(participant),
    }, function(event, snapshot) {

      // Pass the participant and their active status to the custom function
      onUserEnterOrLeave(snapshot.userIndex, event.newValue);
    });
  });

  // Monitor when a new participant joins
  Participants.onOtherParticipantAdded().subscribe(function(participant) {

    // Add them to the main participant list
    participants.push(participant);

    // Monitor their isActiveInSameEffect status
    participant.isActiveInSameEffect.monitor({fireOnInitialValue: true}).subscribeWithSnapshot({
      userIndex: participants.indexOf(participant),
    }, function(event, snapshot) {

      // Pass the participant and their isActiveInSameEffect status to the custom function
      onUserEnterOrLeave(snapshot.userIndex, event.newValue);
    });
  });

  // If a user joined, isActive will be true. Otherwise it will be false
  function onUserEnterOrLeave(userIndex, isActive) {

    // Get the participant that triggered the change in the participant list
    let participant = participants[userIndex];

    // Check if the participant exists in the activeParticipants list
    let activeParticipantCheck = activeParticipants.find(activeParticipant => {
      return activeParticipant.id === participant.id
    });

    if (isActive) {

      // If the participant is found in the active participants list
      if (activeParticipantCheck === undefined) {

        // Add the participant to the active participants list
        activeParticipants.push(participant);

        Diagnostics.log("User " + participant.id + " joined the effect");
        Patches.inputs.setBoolean('canStart', false)
        if (debug) Patches.inputs.setString('setDebugText', "Waiting\nplayer " + participant.id.split("_")[2] + "!")
      }
    } else {

      // If the participant is not found in the active participants list
      if (activeParticipantCheck !== undefined) {

        // Update the active participants list with the new participant
        let activeIndex = activeParticipants.indexOf(activeParticipantCheck);

        activeParticipants.splice(activeIndex, 1);

        Diagnostics.log("User " + participant.id + " left the effect");
        onUserLeft(participant.id)
      }
    }
  }

  Diagnostics.log("Game loaded for " + self.id + " !")
})(); // Enable async/await in JS [part 2]
