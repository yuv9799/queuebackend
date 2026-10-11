export function initSocket(io) {
  io.on('connection', (socket) => {
    // Client asks to subscribe to a specific area's live updates.
    socket.on('subscribe:area', (areaId) => {
      socket.join(`area:${areaId}`);
    });
    socket.on('unsubscribe:area', (areaId) => {
      socket.leave(`area:${areaId}`);
    });
    socket.on('subscribe:all', () => {
      socket.join('area:all');
    });
    // Staff Control Center subscribes to its room.
    socket.on('subscribe:staff', () => {
      socket.join('staff:room');
    });
  });
}