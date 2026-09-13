const MAX_AVATAR_BYTES = 128 * 1024;

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function accountView(user, isAdmin) {
  return {
    id: user.id,
    name: user.name,
    admin: isAdmin(user),
    avatar: user.avatar || null,
    shareBodyWeight: user.shareBodyWeight !== false
  };
}

export function cleanAvatar(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('avatar must be an image');
  const match = value.match(/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4) throw new Error('avatar must be a JPEG or WebP image');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw new Error('avatar is too large');
  const jpeg = match[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = match[1] === 'webp' && bytes.subarray(0, 4).toString() === 'RIFF'
    && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!jpeg && !webp) throw new Error('avatar image is invalid');
  return `data:image/${match[1]};base64,${bytes.toString('base64')}`;
}

export function profileRoutes({ json, readBody, readSession, save, isAdmin }) {
  return {
    'POST /api/profile': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (!['name', 'avatar', 'shareBodyWeight'].some(key => owns(body, key))) {
        return json(res, 400, { error: 'no profile changes supplied' });
      }
      let name = user.name;
      let avatar = user.avatar || null;
      if (owns(body, 'name')) {
        name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
        if (!name) return json(res, 400, { error: 'name required' });
      }
      if (owns(body, 'avatar')) {
        try { avatar = cleanAvatar(body.avatar); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      user.name = name;
      if (avatar) user.avatar = avatar; else delete user.avatar;
      if (owns(body, 'shareBodyWeight')) user.shareBodyWeight = body.shareBodyWeight === true;
      save();
      json(res, 200, { user: accountView(user, isAdmin) });
    }
  };
}
