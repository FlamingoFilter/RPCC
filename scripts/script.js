// Load in the required modules
const Patches = require('Patches');
const Diagnostics = require('Diagnostics');
const Multipeer = require('Multipeer');
const Participants = require('Participants');
const State = require('spark-state');

(async function () { // Enable async/await in JS [part 1]

  // Initialize background count constant
  const totalBackgroundCount = 3;

  // Define a new global scalar signal for the background index
  const backgroundIndex = await State.createGlobalScalarSignal(0, 'backgroundIndex');

  // Define a new global scalar signal for the turn index
  const turnIndex = await State.createGlobalScalarSignal(0, 'turnIndex');

  // Get the tap event from the Patch Editor
  const screenTapPulse = await Patches.outputs.getPulse('screenTapPulse');

  // Get the tap and hold event from the Patch Editor
  const screenTapHoldPulse = await Patches.outputs.getPulse('screenTapHoldPulse');

  // Get the other call participants
  const participants = await Participants.getAllOtherParticipants();

  // Get the current participant, 'self'
  const self = await Participants.self;

  // Push 'self' to the array, since the previous method only fetched
  // other participants
  participants.push(self);

  // Get other participants active in the effect
  const activeParticipants = await Participants.getOtherParticipantsInSameEffect();

  // Push 'self' to the array, since the previous method only fetched
  // other participants
  activeParticipants.push(self);

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

  // Do an initial sort of the active participants when the effect starts
  sortActiveParticipantList();

  // Do an initial check of whether this participant should display the
  // turn indicator
  setTurnIndicatorVisibility();

  // Subscribe to the screen tap event
  screenTapPulse.subscribe(() => {

    // If it's currently my turn
    if (activeParticipants[turnIndex.pinLastValue()].id === self.id) {
      // Increment the background index to show the next background image
      let currentBackgroundIndex = (backgroundIndex.pinLastValue() + 1) % totalBackgroundCount;

      // Set the global variable to the new value
      backgroundIndex.set(currentBackgroundIndex);
    }

  });

  // Subscribe to the tap and hold event
  screenTapHoldPulse.subscribe(function() {

    // If it's currently my turn
    if (activeParticipants[turnIndex.pinLastValue()].id === self.id) {

      // Increment the turn index to pass the turn over to the next participant
      let currentTurnIndex = (turnIndex.pinLastValue() + 1) % activeParticipants.length;

      // Set the global variable to the new value
      turnIndex.set(currentTurnIndex);
    }

  });

  // Monitor our global background signal
  backgroundIndex.monitor().subscribe((event) => {

    // Send the value to the Patch Editor
    Patches.inputs.setScalar('msg_background', backgroundIndex.pinLastValue());
  });

  // Whenever the turn index changes, update the local turn index
  turnIndex.monitor().subscribe((event) => {

    // Check whether this participant needs to show the turn indicator graphic
    setTurnIndicatorVisibility();
  });

  // Sorts the active participant list by participant ID
  // This ensures all participants maintain an identical turn order
  function sortActiveParticipantList(isActive) {

    activeParticipants.sort(function(a, b){
      if (a.id < b.id) {
        return -1;

      } else if (a.id > b.id){
        return 1;
      }
    });
  }

  // Sets the visibility of the turn indicator graphic
  function setTurnIndicatorVisibility() {
    // Check whether this participant's ID matches the ID of the current
    // participant in the turn order and store the result
    let isMyTurn = activeParticipants[turnIndex.pinLastValue()].id === self.id;

    // Send the previous value to the Patch Editor. If the IDs match,
    // the patch graph will display the turn indicator, otherwise the
    // graphic will be hidden
    Patches.inputs.setBoolean('showTurnPanel', isMyTurn);
  }

  // Sorts the active participant list and restarts the turn sequence
  // when there's a change in the participant list.
  // If a user joined, isActive will be true. Otherwise it will be false
  function onUserEnterOrLeave(userIndex, isActive) {

    // Get the participant that triggered the change in the participant list
    let participant = participants[userIndex];

    // Store a reference to the participant before any changes to the list are made
    let currentTurnParticipant = activeParticipants[turnIndex.pinLastValue()];

    // Check if the participant exists in the activeParticipants list
    let activeParticipantCheck = activeParticipants.find(activeParticipant => {
      return activeParticipant.id === participant.id
    });

    if (isActive) {

      // If the participant is found in the active participants list
      if (activeParticipantCheck === undefined) {

        // Add the participant to the active participants list
        activeParticipants.push(participant);

        Diagnostics.log("User joined the effect");
      }
    } else {

      // If the participant is not found in the active participants list
      if (activeParticipantCheck !== undefined) {

        // Update the active participants list with the new participant
        let activeIndex = activeParticipants.indexOf(activeParticipantCheck);

        activeParticipants.splice(activeIndex, 1);

        Diagnostics.log("User left the effect");
      }
    }

    // Sort the active participant list again
    sortActiveParticipantList();

    // Create a reference to the most recent turn index value
    let currentTurnIndex = turnIndex.pinLastValue();

    // Check if the participant whose turn it was is still in the effect
    if (activeParticipants.includes(currentTurnParticipant)) {

      // If they are, change the turnIndex value to that participant's new index value
      currentTurnIndex = activeParticipants.indexOf(currentTurnParticipant);

    } else {

      // If they're not in the effect and they were the last participant in the turn order,
      // wrap the turnIndex value back to the first participant in the turn order
      if(currentTurnIndex >= activeParticipants.length) {
        currentTurnIndex = 0;
      }
    }



    // Check which participant should display the turn graphic
    setTurnIndicatorVisibility();
  }

})(); // Enable async/await in JS [part 2]
