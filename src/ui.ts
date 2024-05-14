import {
    button,
    panel,
    row,
    text,
    heading,
    divider,
    form,
    input
  } from '@metamask/snaps-sdk';
  import { get_ticket_comments, get_user_tickets } from '../utils/backend_functions';
  import { getSnapState, setSnapState } from '.';
  
  let globalPublicComments = {};
  let globalTicketStatuses = {};
  
  export async function showTicketList(address, apiKey) {
    const ticket_data = await get_user_tickets(address, apiKey);
    const tickets = ticket_data.rows;
    let cachedTicketData = {
      comments: {},
      statuses: {}
    };
    const ticketUIs = await Promise.all(tickets.map(async (ticket) => {
      try {
        const comments = await get_ticket_comments(ticket.ticket.id, address, apiKey);
        const publicComments = comments.filter(comment => comment.public);
  
        cachedTicketData['comments'][ticket.ticket.id] = publicComments;
        cachedTicketData['statuses'][ticket.ticket.id] = ticket.ticket.status;
  
        globalPublicComments[ticket.ticket.id] = publicComments;
        globalTicketStatuses[ticket.ticket.id] = ticket.ticket.status;
    
        const latestPublicComment = publicComments.length > 0
          ? publicComments[publicComments.length - 1]
          : { body: 'No public comments found.' };
        let sender = (latestPublicComment['via']['channel'] == 'api' || latestPublicComment['via']['channel'] == 'email') ? '**You**' : '**Agent**'
  
        return [
          divider(),
          heading(`Conversation #${ticket.ticket.id}`),
          text(`${ sender }: ${ latestPublicComment.body }`),
          button({ value: 'Expand', name: `showTicket-${ticket.ticket.id}`, variant: 'primary' })
        ];
      } catch (error) {
        console.log('Could not fetch comments for ticket ', ticket.ticket.id, '. Error: ', error);
        return [];
      }
    }));
    
    // save ticket comments and status to state
    const state = await getSnapState();
    await setSnapState(state?.apiKey as string, state?.address as string, state?.ticketUpdates, state?.dialog as string,
      state?.apiExpiry as string, state?.expiryNotificationsCount, state?.lastAlertTime, cachedTicketData);
  
    // Flatten the array of arrays to get a single array of components
    return ticketUIs.flat();
  }
  
  export async function createInterface( address, apiKey) {
  
    console.log("Creating interface...");
    const flatTicketUIs = await showTicketList( address, apiKey);
  
    return await snap.request({
      method: 'snap_createInterface',
      params: {
        ui: panel([
          heading('Notification preferences'),
          text('Choose the desired notification type for when one of your ticket receives an update.'),
          button({value: 'Configure notifications', name: 'notification-settings', variant:'secondary'}),
          divider(),
          heading('Conversation history'),
          text('Visit your [dashboard](https://tickets.metamask.io) for the complete Web3 support experience.'),
          ...flatTicketUIs // Spread the dynamically created ticket UI components
        ]),
      },
    });
  }
  
  export async function showTicket(ticketId) {
    let comments, status;
  
    if (Object.keys(globalPublicComments).length === 0) {
      const state = await getSnapState();
      comments = state.cachedTicketData['comments'][ticketId];
      status = state.cachedTicketData['statuses'][ticketId];
    }
    else {
      comments = globalPublicComments[ticketId];
      status = globalTicketStatuses[ticketId];
    }
  
    const commentsUI = comments.map(comment => {
      let sender = (comment['via']['channel'] == 'api' || comment['via']['channel'] == 'email') ? '**You**' : '**Agent**'
      return text(`${sender}: ${comment.body}`);
    }).flat();
  
    // display update input field only if ticket is not closed
    const updateForm = (status !== 'closed') ? [form({
      name: `sendcomment-${ticketId}`,
      children: [
        input({
          name: `sendcomment-input`,
          placeholder: "Enter message...",
        }),
        button({
          value: "Send",
          buttonType: "submit",
        }),
      ],
    })]
      :
      [
        { type: 'divider'},
        { type: 'text', value: 'You can no longer reply to this ticket. Feel free to [open a new one](https://support.metamask.io) if needed!' },
      ]
    return (
      panel([
        heading(`Conversation #${ticketId}`),
        divider(),
        ...commentsUI,
        ...updateForm,
        divider(),
        button({ value: 'Go back', name: 'go-back', variant: 'secondary' }),
      ])
    );
  }
  
  export const refreshHomepage = async (id) => {
    const state = await getSnapState();
    const address = state?.address as string;
    const apiKey = state?.apiKey as string;
    const flatTicketUIs = await showTicketList(address, apiKey);
    const go_back_page = [
      heading('Notification preferences'),
      text('Choose the desired notification type for when one of your ticket receives an update.'),
      button({value: 'Configure notifications', name: 'notification-settings', variant:'secondary'}),
      divider(),
      { type: 'heading', value: 'Conversation history' },
      { type: 'text', value: 'Visit your [dashboard](https://tickets.metamask.io) for the complete Web3 support experience.' },
    ];
  
    go_back_page.push(...flatTicketUIs);
  
    const panelUI = { type: 'panel', children: go_back_page };
  
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: panelUI
      },
    });
  }
  
  
  // maybe add a picture for each notif type
  // use the state to fetch the notifications type
  // and let the user know which one is selected
  // in a separate header above
  export const showSettings = async (id) => {
    const state = await getSnapState();
    const notificationSettings = state?.dialog;
    // true means that MM snaps dialog is chosen
    let selectedOption = notificationSettings === 'true' ? 'Metamask snaps notifications' : 'Browser native notifications'
    
    const ui_elements = [
      { type: 'heading', value: 'Notification Preferences' },
      { type: 'text', value: `**Currently selected**: ${selectedOption}.`},
      { type: 'divider' },
      { type: 'heading', value: 'Metamask snaps notifications' },
      { type: 'text', value: 'By choosing Metamask snaps notifications, you have the ability to also reply to the ticket directly from the notification box.' },
      { type: 'button', value: 'Choose Snaps notifications', name: 'notif-choice-snap', variant: 'primary'},
      { type: 'divider' },
      { type: 'heading', value: 'Browser native notifications' },
      { type: 'text', value: 'Browser native notifications are simple and less intrusive, but they do not allow you to reply directly to tickets from within the notification.' },
      { type: 'button', value: 'Choose Browser notifications', name: 'notif-choice-browser', variant: 'primary' },
      { type: 'divider'},
      { type: 'button', value: 'Go back', name: 'go-back', variant: 'secondary'}
    ]
    const panelUI = { type: 'panel', children: ui_elements}
  
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: panelUI
      },
    });
  }
  
  
  export const goBack = async (id) => {
    let entries;
    if (Object.keys(globalPublicComments).length === 0) {
      const state = await getSnapState();
      entries = Object.entries(state.cachedTicketData['comments']);
    }
    else
      entries = Object.entries(globalPublicComments);
  
    entries.reverse();
    const flatTicketUIs = entries.map(([ticketId, publicComments]:[string, any[]]) => {
      if (publicComments.length === 0) return null;
      
      let latestPublicComment = publicComments[publicComments.length - 1];
      let sender = (latestPublicComment['via']['channel'] == 'api' || latestPublicComment['via']['channel'] == 'email') ? '**You**' : '**Agent**'
    
      return [
        divider(),
        heading(`Conversation #${ticketId}`),
        text(`${sender}: ${latestPublicComment.body}`),
        button({ value: 'Expand', name: `showTicket-${ticketId}` })
      ];
    }).filter(Boolean).flat(); // This will remove any null entries
  
  
    const go_back_page = [
      heading('Notification preferences'),
      text('Choose the desired notification type for when one of your ticket receives an update.'),
      button({value: 'Configure notifications', name: 'notification-settings', variant:'secondary'}),
      divider(),
      { type: 'heading', value: 'Conversation history' },
      { type: 'text', value: 'Visit your [dashboard](https://tickets.metamask.io) for the complete Web3 support experience.' },
    ];
  
    go_back_page.push(...flatTicketUIs);
  
    const panelUI = { type: 'panel', children: go_back_page };
  
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: panelUI
      },
    });
  }
  
  
  export const showConfirmationMessage = async (id, txt) => {
    const confirmation_page = [
      { type: 'heading', value: 'All done ✅' },
      { type: 'text', value: txt},
      { type: 'button', value: 'OK', name:'message-sent-ok-button'}
    ]
  
    const panelUI = { type: 'panel', children: confirmation_page };
  
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: panelUI
      }
    }); 
  }
  
  export const showFailedMessage = async (id, txt) => {
    const confirmation_page = [
      { type: 'heading', value: 'Failed :(' },
      { type: 'text', value: txt},
      { type: 'button', value: 'OK', name:'message-sent-ok-button'}
    ]
  
    const panelUI = { type: 'panel', children: confirmation_page };
  
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: panelUI
      }
    }); 
  }
  
  export const showLoadingSpinner = async (id, type) => {
    let message = 'Your comment is being sent to our support team...';
    if (type === 'loading-homepage')
      message = 'Taking you back to the homepage...';
    else if (type === 'notification-settings')
      message = 'Updating notification settings...';
    else if (type === 'loading-ticket')
      message = 'Fetching ticket...';
    else if (type === 'loading-goback')
      message = 'Taking you back...'
    const loading_page = [
      { type: 'heading', value: 'Loading' },
      { type: 'spinner' },
      { type: 'text', value: message }
    ]
  
    const panelUI = { type: 'panel', children: loading_page };
  
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: panelUI
      }
    }); 
  }