const success = (data, message = 'success') => ({ code: 0, data, message });

const paginated = (list, page, pageSize, total) => ({
  code: 0,
  data: { list, pagination: { page, pageSize, total } },
  message: 'success',
});

const error = (code, message, details) => ({
  code,
  message,
  ...(details !== undefined && { details }),
});

module.exports = { success, paginated, error };
