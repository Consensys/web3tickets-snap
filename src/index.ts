import { OnRpcRequestHandler, OnCronjobHandler } from '@metamask/snaps-types';
import { panel, text, heading } from '@metamask/snaps-ui'; 
import { get_user_tickets, get_ticket_comments, update_ticket } from '../utils/backend_functions';

const AUTHORIZED_ORIGIN_LOCAL = 'http://localhost:8000';
const AUTHORIZED_ORIGIN_PROD = 'https://tickets.metamask.io';
const ZD_BOT_SENDER_ID = 397243412931;

const getSnapState = async () => {
  const state = await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'get',
    },
  });

  return state;
};

const setSnapState = async (apiKey: string | null, address: string | null, ticketUpdates: any, dialog : string | null, apiExpiry : string | null, expiryNotificationsCount : any, lastAlertTime : any) => {
  
  return snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: {
        apiKey,
        address,
        ticketUpdates,
        dialog,
        apiExpiry,
        expiryNotificationsCount,
        lastAlertTime
      },
    },
  });
};


// will not catch the following scenario:
// agent posts an update and then within 30 seconds also posts an internal comment
//
// compares current latest comment id on each ticket to the previous latest comment id on the same ticket
// if there's a change -> there was an update
const compareStates = (prev_ticketUpdates: any, current_ticketUpdates: any) => {
  let updatedTicketIds : any = [];
  for (const { ticketId, lastCommentId, isLastCommentPublic, senderId } of current_ticketUpdates) {
    // only consider public messages sent by the agent
    if (senderId !== ZD_BOT_SENDER_ID && isLastCommentPublic) {
      for (const { ticketId: prev_ticketId, lastCommentId: prev_lastCommentId} of prev_ticketUpdates) {
        if (prev_ticketId === ticketId && prev_lastCommentId !== lastCommentId) {
          updatedTicketIds.push(ticketId);
        }
      }
    }
  }
  return updatedTicketIds;
}


// previously named fetchAllTicketCommentsCount
// checks for ticket updates and returns a list of ticket IDs that have received an
// update since the last cronjob run - which occurs every 30 seconds
const checkTicketUpdates = async () => {

  const state = await getSnapState();
  const address = state?.address as string
  const apiKey = state?.apiKey as string
  const dialog = state?.dialog as string
  const apiExpiry = state?.apiExpiry as string

  // if address is empty exit the function
  if (!state || !address || !apiKey) {
    console.log('Address or api key not present in snap state yet.');
    return;
  }

  let ticketUpdates: any = [];
  const prev_ticketUpdates = state?.ticketUpdates;
  const expiryNotificationsCount = state?.expiryNotificationsCount as number;
  const lastAlertTime = state?.lastAlertTime as string;

  try {
    const json : any = await get_user_tickets(address, apiKey);

    if (json && json.hasOwnProperty('count')) {
      const ticket_count = json['count'];

      if (ticket_count > 0) {
        for (let i = 0; i < ticket_count; i++) {
          const lastCommentId = json['rows'][i]['ticket']['last_comment']['id'];
          const isLastCommentPublic = json['rows'][i]['ticket']['last_comment']['public'];
          const ticketId = json['rows'][i]['ticket']['id'];
          const senderId = json['rows'][i]['ticket']['last_comment']['author_id'];
          ticketUpdates.push({ ticketId, lastCommentId, isLastCommentPublic, senderId });
        }
      }
      else {
        console.log('There are no tickets created for this public address yet.');
      }
    }
    else {
      throw new Error('Failed to fetch tickets. Response does not have the "count" property.');
    }
  } catch (error) {
      console.error('Error fetching user tickets:', error);
  }

  let updatedTicketIds: any[] = [];
  
  // if it's the first iteration of the cronjob just initialise the state
  if (!prev_ticketUpdates) {
    console.log('Initialising state...');
    setSnapState(apiKey, address, ticketUpdates, dialog, apiExpiry, expiryNotificationsCount, lastAlertTime);
  }
  else {
    updatedTicketIds = compareStates(prev_ticketUpdates, ticketUpdates);
    if (updatedTicketIds?.length > 0) {
      console.log('Found updates for the following tickets: ', updatedTicketIds);
    }
    setSnapState(apiKey, address, ticketUpdates, dialog, apiExpiry, expiryNotificationsCount, lastAlertTime);
  }

  return updatedTicketIds;
}

async function parseTicketComments(ticketId: any) {
  const state = await getSnapState();
  const address = state?.address as string
  const apiKey = state?.apiKey as string

  // exit if needed variables or state are not available
  if (!state || !ticketId || !address || !apiKey) return 'Could not fetch comments. Please login to https://tickets.metamask.io/ to see your personal dashboard with all tickets open for your ethereum account address';
  
  let formatted_comments = `Login to https://tickets.metamask.io/ to see your personal dashboard with all tickets open for your ethereum account address. \n\n`;
  await get_ticket_comments(ticketId, address, apiKey).then((json: any) => {
    if (json.length > 0) {
      for (let i = 0; i < json.length; i++){
        const comment = json[i]['body'];
        const sender = json[i]['via']['channel'] == 'api' ? '**You**' : '**Agent**'
        formatted_comments += `${sender}: ${comment}\n\n______________________\n\n`;
      }
    }
  })

  return formatted_comments;
}


// updates a ticket with user's new comment, from the notification dialog box
async function updateTicket(ticketId: any, user_comment: any) {
  const state = await getSnapState();

  // exit if state is not available
  if (!state) return -1;
  
  const address = state?.address as string
  const apiKey = state?.apiKey as string
  const update_result = await update_ticket(ticketId, user_comment, address, apiKey);
  return update_result;
}

// notifies the user that a specific ticket has been updated
async function notifyUser(ticketId : any, state: any) {
  const formatted_comments = await parseTicketComments(ticketId);

  // in Metamask notification
  await snap.request({
    method: 'snap_notify',
    params: {
      type: 'inApp',
      message: `An agent has replied on your ticket #${ticketId} !`
    },
  });

  // if user opted for dialog box notifications
  if (state?.dialog === 'true') {
    console.log('notifying via dialog')
    const user_comment = await snap.request({
      method: 'snap_dialog',
      params: {
        type: 'prompt',
        content: panel([
          heading(`Conversation ID: ${ticketId}`),
          text(formatted_comments)
        ]),
        placeholder: 'Enter response to message here...',
      },
    })

    if (user_comment) {
      const update_result = await updateTicket(ticketId, user_comment);
      if (update_result == -1) {
        await snap.request({
          method: 'snap_dialog',
          params: {
            type: 'alert',
            content: panel([
              heading(` Comment could not be submitted.`),
              text(`Please login to your personal dashboard at https://tickets.metamask.io/ and try again.`)
            ])
          },
        })
      }
    }
  }
  // if user opted for browser notifications
  else {
    console.log('notifying via native browser notification')
    await snap.request({
      method: 'snap_notify',
      params: {
        type: 'native',
        message: `An agent has replied on your ticket #${ticketId} !`
      },
    });
  }
}


//Cron Jobs run every 30 seconds or so currently, polling for new messages
export const onCronjob: OnCronjobHandler = async ({ request }) => {
  
  switch (request.method) {
    case 'fireCronjob':
      const state = await getSnapState();

      // for production:
      const apiExpiry = state?.apiExpiry as string;
      const lastAlertTime = state?.lastAlertTime as string;

      // for debugging:
      // console.log(state);
      // const apiExpiry = "Mon Dec 21 2023 13:18:18 GMT+0200";
      // const lastAlertTime = "Mon Dec 21 2023 14:18:18 GMT+0200";

      const currentTime = new Date();
      const alertsInterval = 14400000;
      const timeSinceLastAlert = lastAlertTime ? currentTime.getTime() - new Date(lastAlertTime).getTime() : alertsInterval;
      const alertsCount = (state?.expiryNotificationsCount ?? 0) as number;


      // if api key has expired, notify the user and don't try to perform any other requests
      // every 4 hours, up to 3 alerts
      if (apiExpiry && timeSinceLastAlert >= alertsInterval && alertsCount < 3 && new Date(apiExpiry) < currentTime) {
        await snap.request({
          method: 'snap_dialog',
          params: {
            type: 'alert',
            content: panel([
              heading(` Your authentication key has expired !`),
              text(`Please login to https://tickets.metamask.io/ and sign-in again. Metamask support notifications will not be functional until you do so.`)
            ])
          },
        })
        setSnapState(state?.apiKey as string, state?.address as string, state?.ticketUpdates, state?.dialog as string, state?.apiExpiry as string, alertsCount + 1, currentTime as unknown as string);
      }
      else {
        // only go on if api key is not expired i.e. alertsCount === 0
        if (alertsCount === 0) {
          const updatedTickets = await checkTicketUpdates();
          const fireAlerts = updatedTickets && updatedTickets.length > 0;

          // notify the user for each updated ticket
          if (fireAlerts) {
            for (const ticketId of updatedTickets) {
              await notifyUser(ticketId, state);
            }
          }
        }
      }
        break;

    default:
      throw new Error('Method not found.');
  }
};

/**
 * Handle incoming JSON-RPC requests, sent through `wallet_invokeSnap`.
 *
 * @param args - The request handler args as object.
 * @param args.request - A validated JSON-RPC request object.
 * @returns The result of `snap_dialog`.
 * @throws If the request method is not valid for this snap.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({  origin, request }) => {

  // Origin constants need to be updated in prod
  if (origin !== AUTHORIZED_ORIGIN_LOCAL && origin !== AUTHORIZED_ORIGIN_PROD) {
    throw new Error('Only Metamask domains allowed.');
  }
  
  switch (request.method) {
    
    case 'set_snap_state':
      //console.log(request.params.apiKey, request.params.address, request.params.dialog);
      if (
        (request.params &&
          'apiKey' in request.params &&
          typeof request.params.apiKey === 'string') &&
          request.params &&
          'address' in request.params &&
          typeof request.params.address === 'string' &&
          'dialog' in request.params && 
          typeof request.params.dialog === 'string' &&
          'apiExpiry' in request.params && 
          typeof request.params.apiExpiry === 'string'
      ) {
        await setSnapState(request.params.apiKey, request.params.address, undefined, request.params.dialog, request.params.apiExpiry, undefined, undefined);
        return true;
      }

      throw new Error(`Must provide params.apiKey and params.address and params.dialog and params.apiExpiry. Received ${request.params}`);

    default:
      throw new Error('Method not found.');
  }
};