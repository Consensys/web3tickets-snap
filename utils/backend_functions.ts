import pkg from "crypto-js";
const { SHA256 } = pkg;

export async function get_user_tickets(req_address : any, apikey: any){
    let json_data = null;
    const address_key = SHA256(req_address, { outputLength: 32 }).toString();
    try {
        const url = 'https://71z6182pq3.execute-api.eu-west-1.amazonaws.com/default/tickets';
        const final_url = url + '?address=' + address_key;
        const response = await fetch(final_url, {
            method: 'GET',
            headers: {
                Authorization: apikey,
                Uid: address_key
            }
        })
        const json = await response.json();
        json_data = json;
        // console.log('GET user tickets response: ', json);
    }
    catch(error){
        console.log(error);
    }
    
    return json_data;
    
}


export async function get_ticket_comments(ticket_id : any, req_address: any, apikey: any){
    let json_ticket_comments = null;
    const address_key = SHA256(req_address, { outputLength: 32 }).toString();

    try{
        const url = 'https://71z6182pq3.execute-api.eu-west-1.amazonaws.com/default/tickets?ticketId=' + ticket_id;
        await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: apikey,
                Uid: address_key
            }
        }).then(response => response.json())
        .then(json => {
            json_ticket_comments = json;
            // console.log('GET comments response: ', json);
        })
    }
    catch(error){
        console.log(error);
    }
    finally{
        return json_ticket_comments;
    }
}


export async function update_ticket(ticket_id: any, input_data: any, req_address: any, apikey: any) {
    console.log(`Updating ticket ${ticket_id} with comment: `, input_data);
    const address_key = SHA256(req_address, { outputLength: 32 }).toString();
    let updated = false;
    try {
        const url = 'https://71z6182pq3.execute-api.eu-west-1.amazonaws.com/default/tickets?ticketId='
            + ticket_id + '&create=false' + '&from_snap';
        await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: apikey,
                Uid: address_key
            },
            body: JSON.stringify(input_data)
        }).then(response => response.json())
            .then(json => {
                // console.log('POST update response: ', json);
                updated = true;
            })
    }
    catch (error) {
        console.log(error);
        return false;
    }
    return updated;
}

export async function set_snap_dialog (dialog: boolean, req_address: any, apiKey: any) {
    const url =
        'https://71z6182pq3.execute-api.eu-west-1.amazonaws.com/default/settings';
    const address_key = SHA256(req_address, { outputLength: 32 }).toString();

    
    const options = {
      method: 'POST',
      headers: {
        Uid: address_key,
        Authorization: apiKey,
      },
      body: JSON.stringify({
        dialog: dialog
      }),
    };

    let success = false;

    await fetch(url, options)
        .then((response) => {
            console.log(response.status, response);
            return response.json();
        })
      .then((data) => {
          console.log('Sent notification settings to snap!');
          success = true;
      })
      .catch((error) => {
        console.error(error);
      });

    return success;
  };