const signature = 'func relayBatch(ctx context.Context, ids []string, send func(context.Context, string) error) (int, error)';
const example = (id, code, imports) => ({id, code, imports, visibility:'public', group:'Examples'});
const sealed = (id, group, code, imports) => ({id, code, imports, visibility:'sealed', group});

const relay = {
  id:'go-side-relay-batch',
  signature,
  starter:`package main

import "context"

${signature} {
	return 0, nil
}

func main() {}`,
  reference:`package main

import (
	"context"
	"fmt"
)

${signature} {
	confirmed := 0
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return confirmed, err
		}
		if err := send(ctx, id); err != nil {
			return confirmed, fmt.Errorf("deliver %q: %w", id, err)
		}
		confirmed++
	}
	return confirmed, nil
}

func main() {}`,
  tests:[
    example('relay-in-order', `ctx := context.Background()
ids := []string{"east", "north", "east"}
var sent []string
confirmed, err := relayBatch(ctx, ids, func(got context.Context, id string) error {
	if got != ctx { t.Fatal("Pass the caller's context to the relay.") }
	sent = append(sent, id)
	return nil
})
if err != nil || confirmed != 3 || !slices.Equal(sent, []string{"east", "north", "east"}) ||
	!slices.Equal(ids, []string{"east", "north", "east"}) {
	t.Fatal("Deliver every entry in input order and leave the input slice intact.")
}`, ['context', 'slices']),
    sealed('cancel-before-delivery', 'Cancellation', `ctx, cancel := context.WithCancel(context.Background())
cancel()
confirmed, err := relayBatch(ctx, []string{"east"}, func(context.Context, string) error {
	t.Fatal("Do not send with a canceled context.")
	return nil
})
if confirmed != 0 || err != ctx.Err() { t.Fatal("Return the context error and an empty prefix.") }`, ['context']),
    sealed('cancel-at-confirmed-prefix', 'Cancellation', `ctx, cancel := context.WithCancel(context.Background())
defer cancel()
confirmed, err := relayBatch(ctx, []string{"east", "north"}, func(_ context.Context, id string) error {
	if id != "east" { t.Fatal("Stop before attempting north.") }
	cancel()
	return nil
})
if confirmed != 1 || err != ctx.Err() { t.Fatal("Count the successful east send before observing cancellation.") }`, ['context']),
    sealed('failed-delivery-wraps-cause', 'Errors', `ctx, cancel := context.WithCancel(context.Background())
defer cancel()
problem := errors.New("relay rejected the packet")
var calls []string
confirmed, err := relayBatch(ctx, []string{"east", "north", "west"}, func(_ context.Context, id string) error {
	calls = append(calls, id)
	if id == "north" { cancel(); return problem }
	return nil
})
if confirmed != 1 || !errors.Is(err, problem) || !strings.Contains(err.Error(), "north") ||
	!slices.Equal(calls, []string{"east", "north"}) {
	t.Fatal("Stop at north, wrap the delivery error and retain only the confirmed prefix.")
}`, ['context', 'errors', 'slices', 'strings']),
    sealed('completed-and-empty-relays', 'Edges', `ctx, cancel := context.WithCancel(context.Background())
defer cancel()
confirmed, err := relayBatch(ctx, []string{"east"}, func(context.Context, string) error {
	cancel()
	return nil
})
if confirmed != 1 || err != nil { t.Fatal("A final confirmation completes the batch.") }
confirmed, err = relayBatch(ctx, nil, func(context.Context, string) error {
	t.Fatal("An empty batch does not send.")
	return nil
})
if confirmed != 0 || err != nil { t.Fatal("An empty batch is complete even with a canceled context.") }`, ['context']),
  ],
};

export default {
  id:'relay-recall',
  title:'Recall at the Relay',
  description:'A recall arrives while a supply convoy is delivering packets. Stop future sends and report how many deliveries the dispatcher confirmed.',
  brief:'Each successful send confirms one entry. After a failure or recall the caller needs both the first error and the length of the confirmed prefix.',
  debrief:'Check cancellation before starting each new delivery, and pass the context into the operation doing the work. Keep the count of confirmed sends even when a later send fails. A caller can resume the remaining entries after an explicit rejection. A lost acknowledgment leaves the delivery outcome unknown, so use a stable delivery ID and have the receiver deduplicate retries.',
  standardReward:'The dispatch log now records exactly which entries were confirmed before recall.',
  stages:[
    {
      id:'locate-recall-boundary',
      kind:'choice',
      title:'Hear the recall signal',
      prompt:'The first packet succeeds. Before the second send begins, the caller cancels the context. What should the relay report?',
      options:[
        {id:'zero-progress', label:'Start no more sends and report zero confirmations.'},
        {id:'keep-prefix', label:'Start no more sends and report one confirmation with the cancellation error.'},
        {id:'finish-anyway', label:'Finish every send and report success so the caller gets an exact count.'},
      ],
      answer:'keep-prefix',
      success:'Cancellation stops future work. The first confirmed delivery remains confirmed.',
      retry:'Work the relay already confirmed does not disappear when the context closes.',
    },
    {
      id:'dispatch-with-recall',
      kind:'code',
      title:'Send and count confirmations',
      prompt:`Implement relayBatch. Attempt entries in input order, including repeated IDs, and leave the slice unchanged. Before each send, return the current confirmation count and ctx.Err() if canceled. Call send with the original context and ID. A nil result confirms the entry. On a send error, return the count so far and an error that identifies the ID and wraps the original cause with %w. Stop immediately even if the context was also canceled during that failed send.

An empty batch completes with (0, nil). Once every send succeeds, return the count and nil, including when cancellation happened during the final successful send.`,
      exercise:relay,
    },
    {
      id:'resume-confirmed-prefix',
      kind:'choice',
      title:'Resume from the dispatch log',
      prompt:'The convoy contains EAST, NORTH, WEST. EAST was confirmed. NORTH explicitly rejected delivery before applying any change. After fixing NORTH, where does the new attempt begin?',
      options:[
        {id:'resume-at-north', label:'Start a new attempt with NORTH and WEST, using a fresh context.'},
        {id:'replay-east', label:'Replay EAST first because the batch as a whole returned an error.'},
        {id:'skip-north', label:'Start at WEST because attempting NORTH counts as a confirmation.'},
      ],
      answer:'resume-at-north',
      success:'The first unconfirmed position is one past EAST. A fresh context allows the corrected delivery to proceed.',
      retry:'The checkpoint includes successful sends only. NORTH rejected its packet before applying it.',
    },
    {
      id:'handle-lost-acknowledgment',
      kind:'choice',
      title:'Resolve a missing acknowledgment',
      prompt:'This time NORTH may have applied the packet before its acknowledgment was lost. The relay still reports one confirmed entry. What makes a NORTH retry safe?',
      options:[
        {id:'deduplicate-delivery', label:'Retry NORTH with the same delivery ID and have the receiver atomically deduplicate applied deliveries.'},
        {id:'assume-not-applied', label:'Treat the missing acknowledgment as proof that NORTH applied nothing and issue a new ID.'},
        {id:'cancel-rolls-back', label:'Cancel the old context to roll back any change NORTH made.'},
      ],
      answer:'deduplicate-delivery',
      success:'The stable ID lets the receiver recognize a retry even when the original response was lost.',
      retry:'The local error reports a missing confirmation. It cannot establish what NORTH changed.',
    },
  ],
};
